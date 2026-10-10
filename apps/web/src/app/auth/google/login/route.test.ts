import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getMasterAdminSiteUrl: () => "https://101devs.com",
  getStoreAuthSiteUrl: (origin: string) => origin,
  getGwStoreLoginOrigin: () => process.env.GWSTORE_LOGIN_ORIGIN || null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { GET } from "./route";

describe("GET /auth/google/login", () => {
  beforeEach(() => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
    vi.stubEnv("RAILWAY_SERVICE_ID", "");
    mocks.signInWithOAuth.mockReset();
    mocks.createServerSupabaseClient.mockReset();
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { signInWithOAuth: mocks.signInWithOAuth } });
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2/auth" },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the exact allow-listed callback and carries next in the HttpOnly cookie", async () => {
    const response = await GET(
      new NextRequest(
        "https://101devs.com/auth/google/login?next=%2Fadmin%2Fdiscordbots",
      ),
    );

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://101devs.com/auth/callback",
        scopes: "openid email profile",
        queryParams: { prompt: "select_account" },
      },
    });
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/auth",
    );
    expect(response.cookies.get("gw_auth_next")?.value).toBe("/admin/discordbots");
  });

  it("reaches the master host before creating PKCE cookies when opened from GWStore", async () => {
    const response = await GET(new NextRequest("https://gwstoreofc.com/auth/google/login?next=%2Fadmin%2Fgwstore"));
    expect(response.headers.get("location")).toBe("https://101devs.com/auth/google/login?next=%2Fadmin%2Fgwstore");
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
    expect(response.cookies.get("gw_auth_next")).toBeUndefined();
  });

  it("inicia Google para comprador no host da loja e preserva o carrinho", async () => {
    const next = "/?checkout=1&cart=%5B%5D";
    const response = await GET(new NextRequest(`https://gwstoreofc.com/auth/google/login?${new URLSearchParams({ customer: "1", next })}`));
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: {
      redirectTo: "https://gwstoreofc.com/auth/callback", scopes: "openid email profile", queryParams: { prompt: "select_account" },
    } });
    expect(response.cookies.get("gw_auth_next")?.value).toBe(next);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/auth");
  });

  it("cliente Google também chega à ponte legada antes de criar PKCE", async () => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    const next = "/minhas-compras";
    const response = await GET(new NextRequest(`https://gwstoreofc.com/auth/google/login?${new URLSearchParams({ customer: "1", next })}`));
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe("https://gwstore.vercel.app");
    expect(target.searchParams.get("customer")).toBe("1");
    expect(target.searchParams.get("next")).toBe(next);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    const oauth = await GET(new NextRequest(target));
    expect(mocks.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe("https://gwstore.vercel.app/auth/callback");
    expect(oauth.cookies.get("gw_auth_next")?.value).toBe(next);
  });

  it.each(["/admin", "//evil.example", "/entrar"]) ("cliente Google não retorna a %s", async next => {
    const response = await GET(new NextRequest(`https://gwstoreofc.com/auth/google/login?${new URLSearchParams({ customer: "1", next })}`));
    expect(response.cookies.get("gw_auth_next")?.value).toBe("/");
  });

  it("modo customer não abre na origem do painel mestre ou em host externo", async () => {
    for (const origin of ["https://101devs.com", "https://evil.example"]) {
      expect((await GET(new NextRequest(`${origin}/auth/google/login?customer=1`))).status).toBe(404);
    }
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("retorna falhas do comprador para o formulário da loja", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(null);
    const request = () => new NextRequest("https://gwstoreofc.com/auth/google/login?customer=1&next=%2Fminhas-compras");
    const setup = new URL((await GET(request())).headers.get("location")!);
    expect(setup.pathname).toBe("/entrar");
    expect(setup.searchParams.get("setup")).toBe("1");
    expect(setup.searchParams.get("next")).toBe("/minhas-compras");
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { signInWithOAuth: mocks.signInWithOAuth } });
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "private" } });
    const failure = new URL((await GET(request())).headers.get("location")!);
    expect(failure.pathname).toBe("/entrar");
    expect(failure.searchParams.get("erro")).toBe("oauth");
  });
});
