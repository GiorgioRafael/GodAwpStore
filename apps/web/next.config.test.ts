// @vitest-environment node
import type { NextConfig } from "next";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const withMicrofrontends = vi.hoisted(() => vi.fn((config: NextConfig) => config));
vi.mock("@vercel/microfrontends/next/config", () => ({ withMicrofrontends }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "GWStore");
  vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://gwstore-web-production.up.railway.app");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("configuração da ponte sem perder microfrontends", () => {
  it("mantém o wrapper da GW Vercel e coloca a ponte antes de páginas/assets locais", async () => {
    const config = await (await import("./next.config")).default();
    expect(withMicrofrontends).toHaveBeenCalledOnce();
    const rewrites = await config.rewrites!();
    expect(rewrites).toMatchObject({ beforeFiles: expect.any(Array), afterFiles: [], fallback: [] });
    if (Array.isArray(rewrites)) throw new Error("expected beforeFiles rewrites");
    expect(rewrites.beforeFiles).toHaveLength(3);
    expect(config.experimental?.serverActions).toBeUndefined();
  });

  it("mantém a TH fora do grupo e da ponte", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "THStore");
    const config = await (await import("./next.config")).default();
    expect(withMicrofrontends).not.toHaveBeenCalled();
    expect(await config.rewrites!()).toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
    expect(config.experimental?.serverActions).toBeUndefined();
  });

  it("na Railway serve localmente e só aceita Server Actions dos 3 domínios GW", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "railway-environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "railway-service");
    const config = await (await import("./next.config")).default();
    expect(withMicrofrontends).not.toHaveBeenCalled();
    expect(await config.rewrites!()).toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
    expect(config.experimental?.serverActions).toEqual({
      allowedOrigins: ["gwstore.vercel.app", "gwstoreofc.com", "www.gwstoreofc.com"],
    });
  });

  it("carrega a configuração de produção da Railway sem o pacote de build microfrontends", () => {
    const script = `
      const Module = require("node:module");
      const originalResolve = Module._resolveFilename;
      Module._resolveFilename = function (request, ...args) {
        if (request.startsWith("@vercel/microfrontends")) {
          const error = new Error("build-only package unavailable");
          error.code = "MODULE_NOT_FOUND";
          throw error;
        }
        return originalResolve.call(this, request, ...args);
      };
      const loadConfig = require("next/dist/server/config").default;
      const { PHASE_PRODUCTION_SERVER } = require("next/constants");
      loadConfig(PHASE_PRODUCTION_SERVER, process.cwd()).then(async (config) => {
        console.log(JSON.stringify({ poweredByHeader: config.poweredByHeader, rewrites: await config.rewrites() }));
      }).catch((error) => { console.error(error.message); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production", VERCEL: "" },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      poweredByHeader: false,
      rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
    });
  });
});
