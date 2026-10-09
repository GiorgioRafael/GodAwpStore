import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createRailwayScheduler, readRailwayRuntimeConfig } from "./railway-scheduler.mjs";

const webDirectory = fileURLToPath(new URL("..", import.meta.url));
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

/** @param {{ port: number, signal: AbortSignal, fetcher?: typeof fetch, readinessTimeoutMs?: number,
 * pause?: (delay: number, value?: undefined, options?: { signal?: AbortSignal }) => Promise<unknown> }} options */
export async function waitForRailwayWebServer({
  port,
  signal,
  fetcher = fetch,
  readinessTimeoutMs = 120_000,
  pause = sleep,
}) {
  const deadline = Date.now() + readinessTimeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetcher(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        redirect: "error",
        cache: "no-store",
      });
      if (response.ok) { await response.body?.cancel(); return; }
      await response.body?.cancel();
    } catch {
      if (signal.aborted) break;
    }
    await pause(1_000, undefined, { signal });
  }
  if (!signal.aborted) throw new Error("Next.js did not become ready before the startup deadline.");
}

/**
 * Forward signals directly to Next so in-flight requests and after() can drain.
 * @param {{ env?: Record<string, string | undefined>, processHandle?: Pick<NodeJS.Process, 'once' | 'removeListener' | 'exitCode'>,
 * spawnProcess?: typeof spawn, fetcher?: typeof fetch, logger?: Pick<Console, 'info' | 'warn' | 'error'>,
 * shutdownTimeoutMs?: number }} options
 */
export function startRailwayWeb({
  env = process.env,
  processHandle = process,
  spawnProcess = spawn,
  fetcher = fetch,
  logger = console,
  shutdownTimeoutMs = 30_000,
}) {
  const config = readRailwayRuntimeConfig(env);
  const scheduler = config.cronEnabled ? createRailwayScheduler({
    port: config.port, secret: config.cronSecret, fetcher, logger,
  }) : null;
  const controller = new AbortController();
  let stopping = false;
  let finished = false;
  let forcedExitCode;
  let shutdownTimer;
  const child = spawnProcess(process.execPath, [nextBin, "start", "--hostname", "0.0.0.0", "--port", String(config.port)], {
    cwd: webDirectory,
    env: { ...env, NODE_ENV: "production" },
    stdio: "inherit",
  });

  function stop(signal, exitCode) {
    if (stopping) return;
    stopping = true;
    forcedExitCode = exitCode;
    controller.abort();
    void scheduler?.stop();
    child.kill(signal);
    shutdownTimer = setTimeout(() => child.kill("SIGKILL"), shutdownTimeoutMs);
    shutdownTimer.unref?.();
  }
  const onSigterm = () => stop("SIGTERM", 0);
  const onSigint = () => stop("SIGINT", 0);
  processHandle.once("SIGTERM", onSigterm);
  processHandle.once("SIGINT", onSigint);

  function finish(code) {
    if (finished) return;
    finished = true;
    controller.abort();
    clearTimeout(shutdownTimer);
    void scheduler?.stop();
    processHandle.removeListener("SIGTERM", onSigterm);
    processHandle.removeListener("SIGINT", onSigint);
    processHandle.exitCode = code;
  }
  child.once("error", () => {
    logger.error("[railway:web] could not start Next.js");
    finish(1);
  });
  child.once("exit", () => {
    // A long-running server exiting by itself must trigger Railway's restart.
    finish(forcedExitCode ?? 1);
  });
  if (scheduler) {
    void waitForRailwayWebServer({ port: config.port, signal: controller.signal, fetcher })
      .then(() => { if (!stopping && !controller.signal.aborted) scheduler.start(); })
      .catch(() => {
        if (controller.signal.aborted) return;
        logger.error("[railway:web] startup health check failed");
        stop("SIGTERM", 1);
      });
  } else {
    logger.info("[railway:cron] disabled; set GW_CRON_ENABLED=true only after cutover");
  }
  return child;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { startRailwayWeb(); } catch (error) {
    console.error("[railway:web]", error instanceof Error ? error.message : "startup failed");
    process.exitCode = 1;
  }
}
