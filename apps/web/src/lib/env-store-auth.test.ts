import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ gw: true }));

vi.mock("server-only", () => ({}));
vi.mock("./brand", () => ({ get IS_GWSTORE() { return brand.gw; } }));

import { getGwStoreLoginOrigin, getSiteUrl, getStoreAuthSiteUrl } from "./env";

beforeEach(() => {
  brand.gw = true;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gwstoreofc.com");
  vi.stubEnv("MASTER_ADMIN_SITE_URL", "https://101devs.com");
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("VERCEL_BRANCH_URL", "");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "");
  vi.stubEnv("RAILWAY_STATIC_URL", "");
  vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shop OAuth origin", () => {
  it.each([
    "https://gwstoreofc.com",
    "https://www.gwstoreofc.com",
    "https://gwstore.vercel.app",
  ])("mantém os cookies e o callback em %s mesmo com outro URL canônico", (origin) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin === "https://gwstore.vercel.app"
      ? "https://gwstoreofc.com" : "https://gwstore.vercel.app");

    expect(getStoreAuthSiteUrl(origin)).toBe(origin);
    expect(getSiteUrl(origin)).toBe(process.env.NEXT_PUBLIC_SITE_URL);
  });

  it.each(["VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"])(
    "aceita o alias exato da implantação configurado em %s",
    (variable) => {
      vi.stubEnv(variable, "gwstore-current-ydps915.vercel.app");

      expect(getStoreAuthSiteUrl("https://gwstore-current-ydps915.vercel.app"))
        .toBe("https://gwstore-current-ydps915.vercel.app");
      expect(getStoreAuthSiteUrl("https://unrelated.vercel.app"))
        .toBe("https://gwstoreofc.com");
    },
  );

  it.each([
    "https://101devs.com", "https://www.101devs.com", "https://master.example.com",
  ])("não usa a origem master %s para o OAuth da loja", (origin) => {
    vi.stubEnv("MASTER_ADMIN_SITE_URL", "https://master.example.com");
    vi.stubEnv("VERCEL_URL", new URL(origin).hostname);

    expect(getStoreAuthSiteUrl(origin)).toBe("https://gwstoreofc.com");
  });

  it.each([
    ["RAILWAY_PUBLIC_DOMAIN", "gwstore-production.up.railway.app"],
    ["RAILWAY_STATIC_URL", "https://gwstore-production.up.railway.app"],
  ])("preserva PKCE no domínio Railway configurado em %s", (variable, configured) => {
    vi.stubEnv(variable, configured);

    expect(getStoreAuthSiteUrl("https://gwstore-production.up.railway.app"))
      .toBe("https://gwstore-production.up.railway.app");
    expect(getStoreAuthSiteUrl("http://gwstore-production.up.railway.app"))
      .toBe("https://gwstoreofc.com");
    expect(getStoreAuthSiteUrl("https://other-project.up.railway.app"))
      .toBe("https://gwstoreofc.com");
  });

  it.each([
    "https://untrusted.example", "https://gwstoreofc.com.untrusted.example",
    "http://gwstoreofc.com", "ftp://gwstoreofc.com", "invalid-origin",
    "https://user:password@gwstoreofc.com", "https://localhost:3000",
  ])("usa o endereço canônico quando a origem é inválida para produção: %s", (origin) => {
    expect(getStoreAuthSiteUrl(origin)).toBe("https://gwstoreofc.com");
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "permite cookies locais no desenvolvimento em %s",
    (origin) => {
      vi.stubEnv("NODE_ENV", "development");

      expect(getStoreAuthSiteUrl(origin)).toBe(origin);
    },
  );

  it("não reflete origem externa quando não há configuração no desenvolvimento", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");

    expect(getStoreAuthSiteUrl("https://untrusted.example")).toBe("http://localhost:3000");
  });

  it("mantém o endereço canônico da THStore", () => {
    brand.gw = false;
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://thstore.vercel.app");

    expect(getStoreAuthSiteUrl("https://gwstoreofc.com")).toBe("https://thstore.vercel.app");
  });

  it("preserva a porta local da THStore sem URL configurada no desenvolvimento", () => {
    brand.gw = false;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");

    expect(getStoreAuthSiteUrl("http://localhost:3001")).toBe("http://localhost:3001");
  });

  it("usa o endereço canônico quando nenhuma origem foi informada", () => {
    expect(getStoreAuthSiteUrl()).toBe("https://gwstoreofc.com");
  });

  it("não inventa um callback externo quando falta a configuração de produção", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");

    expect(() => getStoreAuthSiteUrl("https://untrusted.example"))
      .toThrow("NEXT_PUBLIC_SITE_URL não configurada em produção.");
  });
});

describe("temporary GW OAuth entry origin", () => {
  it.each(["https://gwstore.vercel.app", "https://gwstoreofc.com", "https://www.gwstoreofc.com/"])(
    "accepts only a known HTTPS origin: %s",
    (origin) => {
      vi.stubEnv("GWSTORE_LOGIN_ORIGIN", origin);
      expect(getGwStoreLoginOrigin()).toBe(new URL(origin).origin);
    },
  );

  it.each([
    "", "http://gwstore.vercel.app", "https://101devs.com", "https://thstoreadm.vercel.app",
    "https://external.example", "https://gwstore.vercel.app.external.example",
    "https://user:password@gwstore.vercel.app", "https://gwstore.vercel.app:443",
    "https://gwstore.vercel.app:444", "https://gwstore.vercel.app/auth/login",
    "https://gwstore.vercel.app?next=/admin", "https://gwstore.vercel.app#fragment",
    "https://gwstore.vercel.app,external.example",
  ])("does not activate an invalid entry origin: %s", (origin) => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", origin);
    expect(getGwStoreLoginOrigin()).toBeNull();
  });

  it("does not change the THStore OAuth flow even if the setting is copied", () => {
    brand.gw = false;
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    expect(getGwStoreLoginOrigin()).toBeNull();
  });
});
