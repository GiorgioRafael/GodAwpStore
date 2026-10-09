// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRailwayScheduler, readRailwayRuntimeConfig } from "./railway-scheduler.mjs";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const enabledEnv = { NODE_ENV: "production", GW_CRON_ENABLED: "true", NEXT_PUBLIC_STORE_NAME: "GWStore", CRON_SECRET: "private-cron-secret" };

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("Railway startup configuration", () => {
  it("keeps jobs disabled until explicitly enabled, including production", () => {
    expect(readRailwayRuntimeConfig({ NODE_ENV: "production", PORT: "8080" }))
      .toEqual({ port: 8080, cronEnabled: false, cronSecret: "" });
    expect(readRailwayRuntimeConfig({ ...enabledEnv, GW_CRON_ENABLED: "false", CRON_SECRET: "" }).cronEnabled).toBe(false);
  });

  it.each(["GWStore", "GodAwp Store"])("allows GW production and normalizes credentials: %s", (name) => {
    expect(readRailwayRuntimeConfig({ ...enabledEnv, NEXT_PUBLIC_STORE_NAME: name, PORT: "8090", CRON_SECRET: " secret ", DISCORD_GUILD_ID: "1401264061101899820" }))
      .toEqual({ port: 8090, cronEnabled: true, cronSecret: "secret" });
  });

  it.each([
    { ...enabledEnv, NODE_ENV: "development" },
    { ...enabledEnv, NEXT_PUBLIC_STORE_NAME: "THStore" },
    { ...enabledEnv, DISCORD_GUILD_ID: "999999999999999999" },
    { ...enabledEnv, CRON_SECRET: " " },
  ])("rejects enabled jobs with unsafe/missing configuration", (env) => {
    expect(() => readRailwayRuntimeConfig(env)).toThrow();
  });

  it.each(["0", "65536", "3000.5", "3e3", "-20"])("rejects invalid ports: %s", (port) => {
    expect(() => readRailwayRuntimeConfig({ PORT: port })).toThrow(/PORT/);
  });
});

describe("Railway job runner", () => {
  it("preserves UTC schedules, authenticates loopback only, and skips missed/duplicate minutes", async () => {
    vi.useFakeTimers();
    let minute = 0;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true, customer: "private-buyer" }));
    const scheduler = createRailwayScheduler({ port: 8080, secret: "secret", now: () => minute * 60_000, fetcher, logger });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      "http://127.0.0.1:8080/api/cron/discord-ticket-auto-close",
      "http://127.0.0.1:8080/api/cron/discord-ticket-close-reconciliation",
    ]);
    scheduler.tick();
    expect(fetcher).toHaveBeenCalledTimes(2);
    minute = 2; scheduler.tick();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher.mock.calls[2][0]).toBe("http://127.0.0.1:8080/api/cron/discord-top-spenders");
    minute = 7; scheduler.tick();
    expect(fetcher).toHaveBeenCalledTimes(3); // no backfill for minutes 3, 5 or 6
    minute = 182; scheduler.tick();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher.mock.calls[3][0]).toBe("http://127.0.0.1:8080/api/cron/discord-top-spenders");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer secret" }, redirect: "error", cache: "no-store" });
    expect(logger.info).toHaveBeenCalledWith("[railway:cron:ticket-auto-close] HTTP 200");
    expect(logger.info).toHaveBeenCalledWith("[railway:cron:ticket-reconciliation] HTTP 200");
    expect(logger.info).toHaveBeenCalledWith("[railway:cron:top-spenders] HTTP 200");
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/private-buyer|Bearer secret/);
    await scheduler.stop();
  });

  it("does not overlap a running job and aborts it on shutdown", async () => {
    vi.useFakeTimers();
    let minute = 3;
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise<Response>((_resolve, reject) => {
      signal = options?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const scheduler = createRailwayScheduler({ port: 3000, secret: "secret", now: () => minute * 60_000, fetcher, logger });
    scheduler.start();
    minute = 6; scheduler.tick();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("previous run is still active"));
    await scheduler.stop();
    expect(signal?.aborted).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
    minute = 9; scheduler.tick();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("releases a timed-out job for the next cadence and does not log response bodies or credentials", async () => {
    vi.useFakeTimers();
    let minute = 3;
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("private secret from provider")), { once: true });
    })).mockImplementationOnce(async () => new Response("sensitive provider response", { status: 503 }));
    const scheduler = createRailwayScheduler({ port: 3000, secret: "private-secret", now: () => minute * 60_000, fetcher, logger, requestTimeoutMs: 100 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(logger.error).toHaveBeenCalledWith("[railway:cron:ticket-auto-close] HTTP 503");
    minute = 6; scheduler.tick();
    await vi.advanceTimersByTimeAsync(101);
    minute = 9; scheduler.tick();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/private-secret|sensitive provider|secret from provider/);
    await scheduler.stop();
  });
});
