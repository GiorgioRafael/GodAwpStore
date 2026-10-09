const MINUTE_MS = 60_000;
const GW_GUILD_ID = "1401264061101899820";

// Preserve the UTC schedules from vercel.json without depending on Vercel cron.
export const RAILWAY_JOBS = Object.freeze([
  { name: "ticket-auto-close", path: "/api/cron/discord-ticket-auto-close", intervalMinutes: 3, offsetMinutes: 0 },
  { name: "ticket-reconciliation", path: "/api/cron/discord-ticket-close-reconciliation", intervalMinutes: 5, offsetMinutes: 0 },
  { name: "top-spenders", path: "/api/cron/discord-top-spenders", intervalMinutes: 180, offsetMinutes: 2 },
]);

/** @param {Record<string, string | undefined>} [env] */
export function readRailwayRuntimeConfig(env = process.env) {
  const rawPort = env.PORT?.trim() || "3000";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  const cronEnabled = env.GW_CRON_ENABLED?.trim().toLowerCase() === "true";
  if (!cronEnabled) return { port, cronEnabled, cronSecret: "" };
  assertGwStoreProduction(env);
  const cronSecret = env.CRON_SECRET?.trim();
  if (!cronSecret) throw new Error("CRON_SECRET is required when GW_CRON_ENABLED=true.");
  return { port, cronEnabled, cronSecret };
}

/** @param {Record<string, string | undefined>} [env] */
export function assertGwStoreProduction(env = process.env) {
  if (env.NODE_ENV !== "production") throw new Error("GWStore jobs require NODE_ENV=production.");
  const storeSlug = (env.NEXT_PUBLIC_STORE_NAME || "GWStore").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!["gwstore", "godawp-store"].includes(storeSlug)) {
    throw new Error("GWStore jobs cannot run for another store.");
  }
  if (env.DISCORD_GUILD_ID?.trim() && env.DISCORD_GUILD_ID.trim() !== GW_GUILD_ID) {
    throw new Error("GWStore jobs cannot run for another Discord guild.");
  }
}

/**
 * Run only after the web server is ready. Failures retry at the next normal tick.
 * @param {{ port: number, secret: string, fetcher?: typeof fetch, now?: () => number,
 * logger?: Pick<Console, 'info' | 'warn' | 'error'>, requestTimeoutMs?: number }} options
 */
export function createRailwayScheduler({
  port,
  secret,
  fetcher = fetch,
  now = Date.now,
  logger = console,
  requestTimeoutMs = 240_000,
}) {
  if (!secret?.trim()) throw new Error("A cron secret is required.");
  const active = new Map();
  let timer;
  let running = false;
  let lastMinute = -Infinity;

  async function run(job, controller) {
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    timeout.unref?.();
    try {
      const response = await fetcher(`http://127.0.0.1:${port}${job.path}`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      // Keep the deadline active until the response body finishes too.
      await response.text();
      if (response.ok) logger.info(`[railway:cron:${job.name}] HTTP ${response.status}`);
      else logger.error(`[railway:cron:${job.name}] HTTP ${response.status}`);
    } catch {
      if (running) logger.error(`[railway:cron:${job.name}] request failed or timed out`);
    } finally {
      clearTimeout(timeout);
      active.delete(job.name);
    }
  }

  function tick() {
    if (!running) return;
    const minute = Math.floor(now() / MINUTE_MS);
    if (minute <= lastMinute) return;
    lastMinute = minute;
    for (const job of RAILWAY_JOBS) {
      if (minute % job.intervalMinutes !== job.offsetMinutes) continue;
      if (active.has(job.name)) {
        logger.warn(`[railway:cron:${job.name}] previous run is still active; skipped`);
        continue;
      }
      const controller = new AbortController();
      // Register before starting the promise, including a synchronously failing fetcher.
      const entry = { controller, promise: null };
      active.set(job.name, entry);
      entry.promise = run(job, controller);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      tick();
      timer = setInterval(tick, 1_000);
      timer.unref?.();
      logger.info("[railway:cron] enabled; UTC schedules 3min, 5min and 3h");
    },
    tick,
    async stop() {
      running = false;
      clearInterval(timer);
      const entries = [...active.values()];
      entries.forEach(({ controller }) => controller.abort());
      await Promise.allSettled(entries.map(({ promise }) => promise));
    },
  };
}
