// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), exchange: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createClient }));

import { GET } from "./route";
import { CUSTOMER_RECOVERY_COOKIE } from "@/lib/customer-auth-state";

const USER_ID = "10000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gwstoreofc.com");
  vi.stubEnv("MASTER_ADMIN_SITE_URL", "https://101devs.com");
  vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  mocks.createClient.mockResolvedValue({ auth: { exchangeCodeForSession: mocks.exchange } });
  mocks.exchange.mockResolvedValue({ data: { redirectType: "recovery", user: { id: USER_ID }, session: { user: { id: USER_ID } } }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("callback de recuperação do comprador", () => {
  it("abre nova senha após trocar código e vincula cookie à conta autenticada", async () => {
    const next = "/?checkout=1&cart=%5B%5D";
    const response = await GET(new NextRequest("https://gwstore.vercel.app/auth/callback?code=valid", {
      headers: { cookie: `gw_auth_next=${encodeURIComponent(next)}` },
    }));
    expect(mocks.exchange).toHaveBeenCalledWith("valid");
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe("https://gwstore.vercel.app");
    expect(target.pathname).toBe("/entrar");
    expect(target.searchParams.get("mode")).toBe("reset");
    expect(target.searchParams.get("next")).toBe(next);
    const cookie = response.cookies.get(CUSTOMER_RECOVERY_COOKIE);
    expect(cookie).toMatchObject({ value: USER_ID, httpOnly: true, sameSite: "lax", secure: true, maxAge: 600 });
    expect(response.cookies.get("gw_auth_next")?.value).toBe("");
  });

  it("normaliza um destino de recuperação inválido para a loja", async () => {
    const response = await GET(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid&next=%2Fadmin"));
    expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/");
  });

  it.each(["signup", "invalid", null]) ("não abre recuperação quando redirectType é %s", async redirectType => {
    mocks.exchange.mockResolvedValue({ data: { redirectType, user: { id: USER_ID } }, error: null });
    const response = await GET(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid&next=%2Fminhas-compras"));
    expect(response.headers.get("location")).toBe("https://gwstoreofc.com/minhas-compras");
    expect(response.cookies.get(CUSTOMER_RECOVERY_COOKIE)?.value).toBe("");
  });

  it("código expirado não concede acesso à alteração de senha", async () => {
    mocks.exchange.mockResolvedValue({ data: null, error: { message: "expired" } });
    const response = await GET(new NextRequest("https://gwstoreofc.com/auth/callback?code=expired&next=%2Fminhas-compras"));
    expect(new URL(response.headers.get("location")!).searchParams.get("erro")).toBe("callback");
    expect(response.cookies.get(CUSTOMER_RECOVERY_COOKIE)?.value).toBe("");
  });

  it("não concede recuperação se a troca não entregar uma sessão", async () => {
    mocks.exchange.mockResolvedValue({ data: { redirectType: "recovery", user: { id: USER_ID }, session: null }, error: null });
    const response = await GET(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid&next=%2Fminhas-compras"));
    expect(response.headers.get("location")).toBe("https://gwstoreofc.com/minhas-compras");
    expect(response.cookies.get(CUSTOMER_RECOVERY_COOKIE)?.value).toBe("");
  });

  it.each(["email", "google", "discord"]) ("cliente %s volta à loja quando o cookie de retorno expirou", async provider => {
    mocks.exchange.mockResolvedValue({ data: { redirectType: null, user: { id: USER_ID, identities: [{ provider }] } }, error: null });
    const response = await GET(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid"));
    expect(response.headers.get("location")).toBe("https://gwstoreofc.com/");
  });

  it("preserva destino administrativo explícito mesmo na origem GW", async () => {
    mocks.exchange.mockResolvedValue({ data: { redirectType: null, user: { id: USER_ID, identities: [{ provider: "discord" }] } }, error: null });
    const response = await GET(new NextRequest("https://gwstoreofc.com/auth/callback?code=valid&next=%2Fadmin%2Fpedidos"));
    expect(response.headers.get("location")).toBe("https://gwstoreofc.com/admin/pedidos");
  });

  it("preserva fallback original no host mestre quando não há destino", async () => {
    mocks.exchange.mockResolvedValue({ data: { redirectType: null, user: { id: USER_ID, identities: [{ provider: "google" }] } }, error: null });
    const response = await GET(new NextRequest("https://101devs.com/auth/callback?code=valid"));
    expect(response.headers.get("location")).toBe("https://gwstoreofc.com/dashboard");
  });

  it("não transforma callback do painel mestre em recuperação do comprador", async () => {
    const response = await GET(new NextRequest("https://101devs.com/auth/callback?code=valid&next=%2Fadmin%2Fdiscordbots"));
    expect(response.headers.get("location")).toBe("https://101devs.com/admin/discordbots");
    expect(response.cookies.get(CUSTOMER_RECOVERY_COOKIE)?.value).toBe("");
  });
});
