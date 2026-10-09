// @vitest-environment node
import { getRewrittenUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ IS_GWSTORE: true }));
vi.mock("./brand", () => brand);

import {
  getGwStoreRailwayOrigin,
  gwStoreRailwayRewrites,
  gwStoreRailwayServerActionOrigins,
  GWSTORE_VERCEL_CRON_PATHS,
  isGwStoreRailwayBridgeEnabled,
  shouldProxyGwStoreToRailway,
  shouldSkipVercelGwStoreCron,
} from "./railway-bridge";

const railway = "https://gwstore-web-production.up.railway.app";

beforeEach(() => {
  brand.IS_GWSTORE = true;
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", railway);
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

async function rewritten(url: string) {
  const response = await unstable_getResponseFromNextConfig({
    url,
    nextConfig: { rewrites: async () => ({ beforeFiles: gwStoreRailwayRewrites(), afterFiles: [], fallback: [] }) },
  });
  return getRewrittenUrl(response);
}

describe("ponte Vercel da GWStore para sua Railway", () => {
  it.each([railway, `${railway}/`, ` ${railway}/ `])("aceita a origem dedicada %s", origin => {
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", origin);
    expect(getGwStoreRailwayOrigin()).toBe(origin.trim().replace(/\/$/, ""));
  });

  it.each([
    "", "http://gwstore-web-production.up.railway.app", "https://another-store.up.railway.app", "https://origin.gwstoreofc.com",
    "https://gwstore-web-production.up.railway.app.evil.com", "https://gwstore-web-production.up.railway.app:443",
    `${railway}/admin`, `${railway}?token=value`, `${railway}#fragment`,
    "https://user@gwstore-web-production.up.railway.app", "https://gwstore.vercel.app",
    "https://gwstoreofc.com", "https://www.gwstoreofc.com", "https://101devs.com", "https://thstore.vercel.app",
    "https://localhost", "not a URL",
  ])("recusa origem inválida ou de outra aplicação: %s", origin => {
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", origin);
    expect(getGwStoreRailwayOrigin()).toBeNull();
    expect(isGwStoreRailwayBridgeEnabled()).toBe(false);
    expect(gwStoreRailwayRewrites()).toEqual([]);
    expect(shouldSkipVercelGwStoreCron()).toBe(false);
  });

  it.each(["", "0"])("não ativa fora da Vercel: %s", vercel => {
    vi.stubEnv("VERCEL", vercel);
    expect(gwStoreRailwayRewrites()).toEqual([]);
    expect(shouldSkipVercelGwStoreCron()).toBe(false);
  });

  it.each(["RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID"])("nunca pausa a Railway com %s", key => {
    vi.stubEnv(key, "railway-id");
    expect(gwStoreRailwayRewrites()).toEqual([]);
    expect(shouldSkipVercelGwStoreCron()).toBe(false);
  });

  it("mantém a THStore independente mesmo que a variável seja copiada", () => {
    brand.IS_GWSTORE = false;
    expect(gwStoreRailwayRewrites()).toEqual([]);
    expect(shouldSkipVercelGwStoreCron()).toBe(false);
  });

  it("limita a exceção de origem de Server Actions aos 3 hosts próprios na Railway GW", () => {
    expect(gwStoreRailwayServerActionOrigins()).toBeUndefined();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "railway-environment");
    expect(gwStoreRailwayServerActionOrigins()).toBeUndefined();
    vi.stubEnv("RAILWAY_SERVICE_ID", "railway-service");
    expect(gwStoreRailwayServerActionOrigins()).toEqual(["gwstore.vercel.app", "gwstoreofc.com", "www.gwstoreofc.com"]);
    brand.IS_GWSTORE = false;
    expect(gwStoreRailwayServerActionOrigins()).toBeUndefined();
  });

  it.each(["gwstore.vercel.app", "gwstoreofc.com", "www.gwstoreofc.com"])("encaminha páginas, APIs e assets só no host %s", async host => {
    for (const path of ["/", "/admin/pedidos?status=paid&page=2", "/auth/callback?code=abc&next=%2Fadmin",
      "/api/webhooks/discord?item=fruta", "/_next/static/chunk.js", "/_next/image?url=%2Flogo.png&w=640&q=75"]) {
      const url = new URL(`https://${host}${path}`);
      const destination = new URL((await rewritten(url.href))!);
      expect(destination.origin).toBe(railway);
      expect(destination.pathname).toBe(url.pathname);
      expect([...destination.searchParams]).toEqual([...url.searchParams]);
      expect(shouldProxyGwStoreToRailway(url.origin, url.pathname)).toBe(true);
    }
  });

  it.each(["101devs.com", "www.101devs.com", "thstore.vercel.app", "gwstore-preview.vercel.app",
    "gwstoreofcXcom", "gwstoreofc.com.evil.com", "gwstore-web-production.up.railway.app"])("preserva o host %s na aplicação original", async host => {
    expect(await rewritten(`https://${host}/admin`)).toBeNull();
    expect(shouldProxyGwStoreToRailway(`https://${host}`, "/admin")).toBe(false);
  });

  it("mantém os 3 crons na Vercel e não bloqueia outros endpoints", async () => {
    for (const path of GWSTORE_VERCEL_CRON_PATHS) {
      expect(await rewritten(`https://gwstore.vercel.app${path}?run=1`)).toBeNull();
      expect(await rewritten(`https://gwstore.vercel.app${path}/`)).toBeNull();
      expect(shouldProxyGwStoreToRailway("https://gwstore.vercel.app", path)).toBe(false);
    }
    expect(await rewritten("https://gwstore.vercel.app/api/cron/other-job")).toBe(`${railway}/api/cron/other-job`);
    expect(await rewritten("https://gwstore.vercel.app/api/cron/discord-top-spenders-extra")).toBe(`${railway}/api/cron/discord-top-spenders-extra`);
  });
});
