import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { client, createServerSupabaseClient } = vi.hoisted(() => {
  const client = { auth: { signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), signOut: vi.fn() } };
  return { client, createServerSupabaseClient: vi.fn(() => client) };
});
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));

import { GET as login } from "./login/route";
import { GET as callback } from "./callback/route";
import { POST as logout } from "./logout/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gwstoreofc.com");
  vi.stubEnv("MASTER_ADMIN_SITE_URL", "https://101devs.com");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "");
  createServerSupabaseClient.mockReturnValue(client);
  client.auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://discord.com/oauth2/authorize" }, error: null });
  client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  client.auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("login e retorno do painel /admin da loja", () => {
  it.each([
    "https://gwstoreofc.com", "https://www.gwstoreofc.com", "https://gwstore-web-production.up.railway.app",
  ])("entra no legacy antes de criar PKCE ao iniciar por %s", async (origin) => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");

    const response = await login(new NextRequest(`${origin}/auth/login?next=%2Fadmin%2Fpedidos%3Fstatus%3Dpaid`));

    expect(response.headers.get("location"))
      .toBe("https://gwstore.vercel.app/auth/login?next=%2Fadmin%2Fpedidos%3Fstatus%3Dpaid");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("sanitiza next e não reflete parâmetros extras no preflight", async () => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");

    const response = await login(new NextRequest("https://www.gwstoreofc.com/auth/login?next=https%3A%2F%2Fexternal.example&host=external.example"));

    expect(response.headers.get("location")).toBe("https://gwstore.vercel.app/auth/login?next=%2Fadmin");
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("mantém OAuth no legacy pela ponte sem redirecionar outra vez", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "test-environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "test-service");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");

    const response = await login(new NextRequest("https://gwstore-web-production.up.railway.app/auth/login?next=%2Fadmin", {
      headers: { "x-forwarded-host": "gwstore.vercel.app" },
    }));

    expect(response.headers.get("location")).toBe("https://discord.com/oauth2/authorize");
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "discord", options: {
      redirectTo: "https://gwstore.vercel.app/auth/callback?next=%2Fadmin", scopes: "identify email",
    } });
    expect(response.cookies.get("gw_auth_next")?.value).toBe("/admin");
  });

  it("ignora fallback externo inválido e mantém escolha master anterior", async () => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://external.example");
    await login(new NextRequest("https://gwstoreofc.com/auth/login?next=%2Fadmin"));
    expect(client.auth.signInWithOAuth.mock.calls[0][0].options.redirectTo)
      .toBe("https://gwstoreofc.com/auth/callback?next=%2Fadmin");

    vi.clearAllMocks();
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    await login(new NextRequest("https://gwstoreofc.com/auth/login?next=%2Fadmin%2Fgwstore"));
    expect(createServerSupabaseClient).toHaveBeenCalled();
    expect(client.auth.signInWithOAuth).toHaveBeenCalled();
  });

  it.each([
    ["https://gwstore-web-production.up.railway.app", "gwstore.vercel.app"],
    ["https://gwstore-web-production.up.railway.app", "gwstoreofc.com"],
    ["https://gwstore-web-production.up.railway.app", "www.gwstoreofc.com"],
    ["https://0.0.0.0:8080", "gwstore.vercel.app"],
    ["http://127.0.0.1:8080", "www.gwstoreofc.com"],
  ])("preserva login, callback do cookie e logout pela ponte %s → %s", async (actualOrigin, browserHost) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "test-environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "test-service");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");
    vi.stubEnv("PORT", "8080");
    const headers = {
      host: "gwstore-web-production.up.railway.app",
      "x-forwarded-host": browserHost,
      "x-forwarded-proto": "https",
    };
    const browserOrigin = `https://${browserHost}`;
    const start = await login(new NextRequest(`${actualOrigin}/auth/login?next=%2Fadmin%2Fpedidos`, { headers }));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "discord", options: {
      redirectTo: `${browserOrigin}/auth/callback?next=%2Fadmin%2Fpedidos`, scopes: "identify email",
    } });
    expect(start.cookies.get("gw_auth_next")?.value).toBe("/admin/pedidos");
    expect(start.cookies.get("gw_auth_next")?.secure).toBe(true);
    expect(start.headers.get("set-cookie")).not.toContain("Domain=");

    const finish = await callback(new NextRequest(`${actualOrigin}/auth/callback?code=valid`, {
      headers: { ...headers, cookie: "gw_auth_next=%2Fadmin%2Fpedidos" },
    }));
    expect(finish.headers.get("location")).toBe(`${browserOrigin}/admin/pedidos`);
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("valid");

    const failed = await callback(new NextRequest(`${actualOrigin}/auth/callback?next=%2Fadmin`, { headers }));
    expect(failed.headers.get("location")).toBe(`${browserOrigin}/login?erro=callback`);
    const exit = await logout(new NextRequest(`${actualOrigin}/auth/logout?next=%2Fadmin`, {
      method: "POST", headers,
    }));
    expect(exit.headers.get("location")).toBe(`${browserOrigin}/login`);
  });

  it("ignora forwarded host forjado num acesso direto ao domínio GW", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "test-environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "test-service");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");

    const response = await callback(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid&next=%2Fadmin", {
      headers: { "x-forwarded-host": "101devs.com" },
    }));

    expect(response.headers.get("location")).toBe("https://gwstoreofc.com/admin");
  });

  it("abre OAuth Discord com /admin como destino padrão", async () => {
    const response = await login(new NextRequest("https://gwstoreofc.com/auth/login"));
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "discord", options: {
      redirectTo: "https://gwstoreofc.com/auth/callback?next=%2Fadmin", scopes: "identify email",
    } });
    expect(response.cookies.get("gw_auth_next")?.value).toBe("/admin");
  });

  it("mantém o retorno em GWStore e não o envia ao painel mestre", async () => {
    const response = await callback(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid&next=%2Fadmin%2Fpedidos%3Fstatus%3Dpaid"));
    expect(response.headers.get("location")).toBe("https://gwstoreofc.com/admin/pedidos?status=paid");
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("valid");
  });

  it.each([
    ["https://gwstoreofc.com", "https://gwstore.vercel.app"],
    ["https://www.gwstoreofc.com", "https://gwstoreofc.com"],
    ["https://gwstore.vercel.app", "https://gwstoreofc.com"],
  ])("mantém login, cookie e callback na mesma origem %s mesmo com site canônico %s", async (origin, canonical) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", canonical);
    const start = await login(new NextRequest(`${origin}/auth/login?next=%2Fadmin`));
    const options = client.auth.signInWithOAuth.mock.calls[0][0].options;
    expect(new URL(options.redirectTo).origin).toBe(origin);
    expect(start.cookies.get("gw_auth_next")?.value).toBe("/admin");
    expect(start.cookies.get("gw_auth_next")?.secure).toBe(true);
    const finish = await callback(new NextRequest(`${origin}/auth/callback?code=valid&next=%2Fadmin`));
    expect(finish.headers.get("location")).toBe(`${origin}/admin`);
    const exit = await logout(new NextRequest(`${origin}/auth/logout?next=%2Fadmin`, { method: "POST" }));
    expect(exit.headers.get("location")).toBe(`${origin}/login`);
  });

  it("recupera next do cookie e mantém a roleta pública", async () => {
    const cookie = await callback(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid", { headers: { cookie: "gw_auth_next=%2Fadmin" } }));
    expect(cookie.headers.get("location")).toBe("https://gwstoreofc.com/admin");
    const roulette = await callback(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid&next=%2Froleta"));
    expect(roulette.headers.get("location")).toBe("https://gwstoreofc.com/roleta");
  });

  it("erros de login da loja retornam ao login Discord", async () => {
    client.auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "oauth" } });
    const failedLogin = await login(new NextRequest("https://gwstoreofc.com/auth/login?next=%2Fadmin"));
    expect(failedLogin.headers.get("location")).toBe("https://gwstoreofc.com/login?erro=oauth");
    const failedCallback = await callback(new NextRequest("https://gwstoreofc.com/auth/callback?next=%2Fadmin"));
    expect(failedCallback.headers.get("location")).toBe("https://gwstoreofc.com/login?erro=callback");
  });

  it("preserva o retorno mestre Google no domínio da 101Devs", async () => {
    const master = await callback(new NextRequest("https://101devs.com/auth/callback?code=valid&next=%2Fadmin"));
    expect(master.headers.get("location")).toBe("https://101devs.com/admin");
    const knownTab = await callback(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid&next=%2Fadmin%2Fgwstore"));
    expect(knownTab.headers.get("location")).toBe("https://101devs.com/admin/gwstore");
  });

  it("logout mantém separado o login da loja e o login mestre", async () => {
    const shop = await logout(new NextRequest("https://gwstoreofc.com/auth/logout?next=%2Fadmin", { method: "POST" }));
    expect(shop.headers.get("location")).toBe("https://gwstoreofc.com/login");
    const master = await logout(new NextRequest("https://101devs.com/auth/logout?next=%2Fadmin", { method: "POST" }));
    expect(master.headers.get("location")).toBe("https://101devs.com/admin/discordbots/login?next=%2Fadmin");
  });
});
