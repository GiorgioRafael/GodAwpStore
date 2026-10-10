// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestHeaders: new Headers(), headers: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

import { redirectCustomerAuthToLoginHost } from "./customer-auth-origin";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
  vi.stubEnv("MASTER_ADMIN_SITE_URL", "https://101devs.com");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  mocks.requestHeaders = new Headers({ host: "gwstoreofc.com", "x-forwarded-proto": "https" });
  mocks.headers.mockImplementation(async () => mocks.requestHeaders);
});
afterEach(() => vi.unstubAllEnvs());

describe("entrada do formulário no host que recebe o callback", () => {
  it("preserva estado da página e carrinho ao entrar na ponte", async () => {
    const next = "/?checkout=1&cart=%5B%5D";
    await expect(redirectCustomerAuthToLoginHost(next, { mode: "signup", erro: "callback", setup: "1" }))
      .rejects.toThrow(`NEXT_REDIRECT:https://gwstore.vercel.app/entrar?next=${encodeURIComponent(next)}&mode=signup&erro=callback&setup=1`);
  });

  it("não redireciona outra vez quando já está no host de login", async () => {
    mocks.requestHeaders = new Headers({ host: "gwstore.vercel.app", "x-forwarded-proto": "https" });
    await expect(redirectCustomerAuthToLoginHost("/minhas-compras")).resolves.toBeUndefined();
  });

  it("ignora o destino externo e nunca lê headers quando a ponte está desativada", async () => {
    await expect(redirectCustomerAuthToLoginHost("//evil.example"))
      .rejects.toThrow("NEXT_REDIRECT:https://gwstore.vercel.app/entrar?next=%2F");
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "");
    mocks.headers.mockClear();
    await expect(redirectCustomerAuthToLoginHost("/")).resolves.toBeUndefined();
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("um host arbitrário não adquire confiança por forwarded headers", async () => {
    mocks.requestHeaders = new Headers({ host: "evil.example", "x-forwarded-proto": "https", "x-forwarded-host": "gwstoreofc.com" });
    await expect(redirectCustomerAuthToLoginHost("/")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("reconhece a origem pública somente através da ponte Railway validada", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "service");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");
    mocks.requestHeaders = new Headers({ host: "gwstore-web-production.up.railway.app", "x-forwarded-proto": "https", "x-gwstore-public-host": "gwstore.vercel.app" });
    await expect(redirectCustomerAuthToLoginHost("/")).resolves.toBeUndefined();
  });
});
