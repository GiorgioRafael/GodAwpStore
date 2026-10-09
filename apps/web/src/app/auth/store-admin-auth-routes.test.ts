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
  createServerSupabaseClient.mockReturnValue(client);
  client.auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://discord.com/oauth2/authorize" }, error: null });
  client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  client.auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("login e retorno do painel /admin da loja", () => {
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
