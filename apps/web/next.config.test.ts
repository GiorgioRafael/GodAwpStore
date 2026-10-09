// @vitest-environment node
import type { NextConfig } from "next";
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
    const config = (await import("./next.config")).default;
    expect(withMicrofrontends).toHaveBeenCalledOnce();
    const rewrites = await config.rewrites!();
    expect(rewrites).toMatchObject({ beforeFiles: expect.any(Array), afterFiles: [], fallback: [] });
    if (Array.isArray(rewrites)) throw new Error("expected beforeFiles rewrites");
    expect(rewrites.beforeFiles).toHaveLength(3);
    expect(config.experimental?.serverActions).toBeUndefined();
  });

  it("mantém a TH fora do grupo e da ponte", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "THStore");
    const config = (await import("./next.config")).default;
    expect(withMicrofrontends).not.toHaveBeenCalled();
    expect(await config.rewrites!()).toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
    expect(config.experimental?.serverActions).toBeUndefined();
  });

  it("na Railway serve localmente e só aceita Server Actions dos 3 domínios GW", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "railway-environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "railway-service");
    const config = (await import("./next.config")).default;
    expect(withMicrofrontends).not.toHaveBeenCalled();
    expect(await config.rewrites!()).toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
    expect(config.experimental?.serverActions).toEqual({
      allowedOrigins: ["gwstore.vercel.app", "gwstoreofc.com", "www.gwstoreofc.com"],
    });
  });
});
