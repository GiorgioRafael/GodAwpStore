// @vitest-environment node
import { EventEmitter } from "node:events";
import type { ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startRailwayWeb, waitForRailwayWebServer } from "./start-railway.mjs";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function processFixture() {
  const handle = Object.assign(new EventEmitter(), { exitCode: undefined as number | undefined });
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
  const spawnProcess = vi.fn(() => child as unknown as ChildProcess);
  return { handle, child, spawnProcess, options: {
    processHandle: handle as unknown as NodeJS.Process,
    spawnProcess: spawnProcess as unknown as typeof spawn,
    logger,
  } };
}

describe("Railway Next launcher", () => {
  it("starts Next directly on the platform port and leaves jobs disabled before cutover", () => {
    const fixture = processFixture();
    const fetcher = vi.fn();
    startRailwayWeb({ ...fixture.options, env: { NODE_ENV: "production", PORT: "8080", GW_CRON_ENABLED: "false" }, fetcher });
    expect(fixture.spawnProcess).toHaveBeenCalledWith(process.execPath,
      [expect.stringMatching(/next[\/]dist[\/]bin[\/]next$/), "start", "--hostname", "0.0.0.0", "--port", "8080"],
      expect.objectContaining({ cwd: expect.stringMatching(/apps[\/]web[\/]$/), stdio: "inherit", env: expect.objectContaining({ NODE_ENV: "production" }) }));
    expect(fetcher).not.toHaveBeenCalled();
    fixture.child.emit("exit", 0);
  });

  it("fails before spawning for enabled jobs with missing credentials", () => {
    const fixture = processFixture();
    expect(() => startRailwayWeb({ ...fixture.options, env: { NODE_ENV: "production", GW_CRON_ENABLED: "true" } })).toThrow(/CRON_SECRET/);
    expect(fixture.spawnProcess).not.toHaveBeenCalled();
  });

  it("does not launch authenticated jobs until the new local server is ready", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T00:03:00Z"));
    const fixture = processFixture();
    let ready: (value: Response) => void = () => undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>(resolve => { ready = resolve; }))
      .mockResolvedValue(Response.json({ ok: true }));
    startRailwayWeb({ ...fixture.options,
      env: { NODE_ENV: "production", NEXT_PUBLIC_STORE_NAME: "GWStore", GW_CRON_ENABLED: "true", CRON_SECRET: "secret" }, fetcher,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/health");
    ready(Response.json({ ok: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]).toEqual([
      "http://127.0.0.1:3000/api/cron/discord-ticket-auto-close",
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    ]);
    fixture.handle.emit("SIGTERM");
    fixture.child.emit("exit", null);
  });

  it.each(["SIGTERM", "SIGINT"])("forwards %s to Next, allows draining, and removes listeners", (signal) => {
    vi.useFakeTimers();
    const fixture = processFixture();
    startRailwayWeb({ ...fixture.options, env: {} });
    fixture.handle.emit(signal);
    expect(fixture.child.kill).toHaveBeenCalledWith(signal);
    expect(fixture.handle.exitCode).toBeUndefined();
    fixture.child.emit("exit", null);
    expect(fixture.handle.exitCode).toBe(0);
    expect(fixture.handle.listenerCount("SIGTERM")).toBe(0);
    vi.advanceTimersByTime(30_001);
    expect(fixture.child.kill).toHaveBeenCalledOnce();
  });

  it("bounds shutdown and makes unexpected child exit restartable", () => {
    vi.useFakeTimers();
    const fixture = processFixture();
    startRailwayWeb({ ...fixture.options, env: {}, shutdownTimeoutMs: 100 });
    fixture.handle.emit("SIGTERM");
    vi.advanceTimersByTime(100);
    expect(fixture.child.kill).toHaveBeenLastCalledWith("SIGKILL");
    fixture.child.emit("exit", null);
    const unexpected = processFixture();
    startRailwayWeb({ ...unexpected.options, env: {} });
    unexpected.child.emit("exit", 0);
    expect(unexpected.handle.exitCode).toBe(1);
  });

  it("reports spawn failure without leaking exception data", () => {
    const fixture = processFixture();
    startRailwayWeb({ ...fixture.options, env: {} });
    fixture.child.emit("error", new Error("sensitive launch config"));
    expect(fixture.handle.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith("[railway:web] could not start Next.js");
  });
});

describe("Railway readiness before cron", () => {
  it("waits for local health to return success without reflecting public DNS or cron credentials", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("starting", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const pause = vi.fn(async () => undefined);
    await waitForRailwayWebServer({ port: 8080, signal: new AbortController().signal, fetcher, pause });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8080/api/health", expect.objectContaining({ redirect: "error", cache: "no-store" }));
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
    expect(pause).toHaveBeenCalledOnce();
  });

  it("does not keep retrying a cancelled startup", async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn();
    await waitForRailwayWebServer({ port: 3000, signal: controller.signal, fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(waitForRailwayWebServer({ port: 3000, signal: new AbortController().signal, readinessTimeoutMs: 0 }))
      .rejects.toThrow(/startup deadline/);
  });
});
