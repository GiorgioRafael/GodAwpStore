import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ gw: true }));
vi.mock("./brand", () => ({ get IS_GWSTORE() { return brand.gw; } }));

import { publicRequestOrigin } from "./public-request-origin";

const railwayHost = "gwstore-web-production.up.railway.app";
const railwayOrigin = `https://${railwayHost}`;

beforeEach(() => {
  brand.gw = true;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "test-environment");
  vi.stubEnv("RAILWAY_SERVICE_ID", "test-service");
  vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", railwayHost);
  vi.stubEnv("RAILWAY_STATIC_URL", "");
  vi.stubEnv("PORT", "8080");
});
afterEach(() => vi.unstubAllEnvs());

describe("public origin through the GW Railway bridge", () => {
  it.each(["gwstore.vercel.app", "gwstoreofc.com", "www.gwstoreofc.com"])(
    "preserves browser origin %s through the configured Railway destination",
    (host) => {
      expect(publicRequestOrigin(request(railwayOrigin, { "x-forwarded-host": host })))
        .toBe(`https://${host}`);
    },
  );

  it("recognizes the exact static URL alias when the public-domain variable is absent", () => {
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "");
    vi.stubEnv("RAILWAY_STATIC_URL", railwayOrigin);

    expect(publicRequestOrigin(request(railwayOrigin, { "x-forwarded-host": "gwstore.vercel.app" })))
      .toBe("https://gwstore.vercel.app");
  });

  it.each([
    "101devs.com", "www.101devs.com", "thstoreadm.vercel.app", "external.example",
    "https://gwstore.vercel.app", "gwstore.vercel.app:443", "user@gwstore.vercel.app",
    "gwstore.vercel.app,external.example", "gwstore.vercel.app/path",
    "gwstore.vercel.app.external.example",
  ])("ignores unsupported forwarded host %s", (host) => {
    expect(publicRequestOrigin(request(railwayOrigin, { "x-forwarded-host": host })))
      .toBe(railwayOrigin);
  });

  it.each([
    "https://gwstore.vercel.app", "https://gwstoreofc.com", "https://www.gwstoreofc.com",
    "https://101devs.com", "https://thstoreadm.vercel.app", "https://other.up.railway.app",
  ])("ignores forged forwarding headers on a direct origin %s", (origin) => {
    expect(publicRequestOrigin(request(origin, { "x-forwarded-host": "gwstore.vercel.app" })))
      .toBe(origin);
  });

  it.each(["RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID"])(
    "does not trust forwarding without automatic Railway identity %s",
    (variable) => {
      vi.stubEnv(variable, "");

      expect(publicRequestOrigin(request(railwayOrigin, { "x-forwarded-host": "gwstore.vercel.app" })))
        .toBe(railwayOrigin);
    },
  );

  it.each([
    "https://101devs.com", "https://thstoreadm.vercel.app", "https://external.example",
    "https://user@gwstore-web-production.up.railway.app",
    "https://gwstore-web-production.up.railway.app:444",
    "https://gwstore-web-production.up.railway.app/path", "ftp://gwstore-web-production.up.railway.app",
  ])("does not establish a bridge with an invalid configured alias %s", (configured) => {
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", configured);

    expect(publicRequestOrigin(request(railwayOrigin, { "x-forwarded-host": "gwstore.vercel.app" })))
      .toBe(railwayOrigin);
  });

  it("does not interpret forwarding for a THStore deployment", () => {
    brand.gw = false;

    expect(publicRequestOrigin(request(railwayOrigin, { "x-forwarded-host": "gwstore.vercel.app" })))
      .toBe(railwayOrigin);
  });

  it.each(["https://0.0.0.0:8080", "https://127.0.0.1:8080", "http://localhost:8080"])(
    "resolves NextNode binding %s only with the known host and HTTPS edge protocol",
    (binding) => {
      expect(publicRequestOrigin(request(binding, {
        host: railwayHost, "x-forwarded-host": "gwstore.vercel.app", "x-forwarded-proto": "https",
      }))).toBe("https://gwstore.vercel.app");
    },
  );

  it("uses the direct custom Host on the local binding and ignores forwarded-host spoofing", () => {
    expect(publicRequestOrigin(request("https://0.0.0.0:8080", {
      host: "www.gwstoreofc.com", "x-forwarded-host": "gwstore.vercel.app", "x-forwarded-proto": "https",
    }))).toBe("https://www.gwstoreofc.com");
  });

  it.each([
    "101devs.com", "thstoreadm.vercel.app", "external.example", "other.up.railway.app",
    `${railwayHost}:443`, `${railwayHost},gwstore.vercel.app`, "https://gwstore.vercel.app",
  ])("rejects unknown or malformed HTTP Host on the local binding: %s", (host) => {
    expect(publicRequestOrigin(request("https://0.0.0.0:8080", {
      host, "x-forwarded-host": "gwstore.vercel.app", "x-forwarded-proto": "https",
    }))).toBe("https://0.0.0.0:8080");
  });

  it.each(["https://0.0.0.0:3000", "https://unrecognized.internal:8080"])(
    "does not trust a different binding host or port: %s",
    (binding) => {
      expect(publicRequestOrigin(request(binding, {
        host: railwayHost, "x-forwarded-host": "gwstore.vercel.app", "x-forwarded-proto": "https",
      }))).toBe(binding);
    },
  );

  it.each(["", "http", "https,http", "ftp"])("rejects insecure or ambiguous binding protocol: %s", (protocol) => {
    expect(publicRequestOrigin(request("https://0.0.0.0:8080", {
      host: railwayHost, "x-forwarded-host": "gwstore.vercel.app", "x-forwarded-proto": protocol,
    }))).toBe("https://0.0.0.0:8080");
  });

  it("does not use forwarded headers from an HTTP Railway origin in production", () => {
    const origin = `http://${railwayHost}`;
    expect(publicRequestOrigin(request(origin, { "x-forwarded-host": "gwstore.vercel.app" })))
      .toBe(origin);
  });
});

function request(origin: string, headers: Record<string, string>) {
  return new Request(`${origin}/auth/callback?code=test`, { headers });
}
