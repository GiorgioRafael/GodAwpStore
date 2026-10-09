import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGiveawayOAuthState: vi.fn(),
  getGiveawayOAuthContext: vi.fn(),
  signInWithOAuth: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand", () => ({ IS_GWSTORE: true }));
vi.mock("@/lib/giveaways/oauth-state", () => ({
  GIVEAWAY_OAUTH_COOKIE: "gw_giveaway_oauth_state",
  createGiveawayOAuthState: mocks.createGiveawayOAuthState,
  getGiveawayOAuthStateSecret: () => "signed-state-secret",
}));
vi.mock("@/lib/giveaways/repository", () => ({
  getGiveawayOAuthContext: mocks.getGiveawayOAuthContext,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { GET } from "./route";

const giveaway = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "abc123def456",
  startsAt: "2026-07-20T00:00:00.000Z",
  endsAt: "2099-07-21T00:00:00.000Z",
  status: "active" as const,
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gwstoreofc.com");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "");
  mocks.createServerSupabaseClient.mockResolvedValue({ auth: { signInWithOAuth: mocks.signInWithOAuth } });
  mocks.getGiveawayOAuthContext.mockResolvedValue(giveaway);
  mocks.createGiveawayOAuthState.mockReturnValue("signed-state");
  mocks.signInWithOAuth.mockResolvedValue({
    data: { url: "https://discord.com/oauth2/authorize?state=signed-state" },
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("giveaway OAuth start", () => {
  it("inicia sorteio no legacy antes de gerar estado e PKCE, mantendo indicação validada", async () => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    const ref = "22222222-2222-4222-8222-222222222222";

    const response = await GET(new Request(`https://www.gwstoreofc.com/api/sorteios/oauth/iniciar?slug=abc123def456&ref=${ref}`));

    expect(response.headers.get("location"))
      .toBe(`https://gwstore.vercel.app/api/sorteios/oauth/iniciar?slug=abc123def456&ref=${ref}`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.getGiveawayOAuthContext).not.toHaveBeenCalled();
    expect(mocks.createGiveawayOAuthState).not.toHaveBeenCalled();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("mantém modo visualizar e inicia OAuth quando já está no host legado", async () => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    const response = await GET(new Request("https://gwstoreofc.com/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar"));
    expect(response.headers.get("location"))
      .toBe("https://gwstore.vercel.app/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar");

    await GET(new Request(response.headers.get("location")!));
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({ provider: "discord", options: {
      redirectTo: "https://gwstore.vercel.app/api/sorteios/oauth/retorno?state=signed-state", scopes: "identify",
    } });
  });

  it.each(["https://gwstore-web-production.up.railway.app", "https://0.0.0.0:8080"])(
    "mantém query state e callback legado pela ponte Railway em %s",
    async (actualOrigin) => {
      vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "test-environment");
      vi.stubEnv("RAILWAY_SERVICE_ID", "test-service");
      vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");
      vi.stubEnv("PORT", "8080");

      const response = await GET(new Request(`${actualOrigin}/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar`, {
        headers: {
          host: "gwstore-web-production.up.railway.app",
          "x-gwstore-public-host": "gwstore.vercel.app",
          "x-forwarded-host": "gwstore-web-production.up.railway.app",
          "x-forwarded-proto": "https",
        },
      }));

      expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
        provider: "discord",
        options: {
          redirectTo: "https://gwstore.vercel.app/api/sorteios/oauth/retorno?state=signed-state",
          scopes: "identify",
        },
      });
      expect(response.headers.get("set-cookie")).toContain("gw_giveaway_oauth_state=signed-state");
      expect(response.headers.get("set-cookie")).toContain("Path=/api/sorteios/oauth/retorno");
      expect(response.headers.get("set-cookie")).not.toContain("Domain=");
    },
  );

  it.each([
    "https://gwstoreofc.com",
    "https://www.gwstoreofc.com",
    "https://gwstore.vercel.app",
  ])("mantém o callback e o cookie de estado na origem %s", async (origin) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin === "https://gwstore.vercel.app"
      ? "https://gwstoreofc.com" : "https://gwstore.vercel.app");

    const response = await GET(new Request(
      `${origin}/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar`,
    ));

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "discord",
      options: {
        redirectTo: `${origin}/api/sorteios/oauth/retorno?state=signed-state`,
        scopes: "identify",
      },
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("gw_giveaway_oauth_state=signed-state");
    expect(cookie).toContain("Path=/api/sorteios/oauth/retorno");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
  });

  it("mantém erros de validação no domínio do sorteio", async () => {
    const response = await GET(new Request(
      "https://gwstore.vercel.app/api/sorteios/oauth/iniciar?slug=invalid",
    ));

    expect(response.headers.get("location"))
      .toBe("https://gwstore.vercel.app/?erro=link_invalido");
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("ignora forwarded host e origem desconhecida ao montar o callback", async () => {
    await GET(new Request(
      "https://untrusted.example/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar",
      { headers: { "x-gwstore-public-host": "gwstore.vercel.app", "x-forwarded-host": "101devs.com" } },
    ));

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        redirectTo: "https://gwstoreofc.com/api/sorteios/oauth/retorno?state=signed-state",
      }),
    }));
  });

  it("usa apenas identificação no modo Visualizar e não carrega indicação", async () => {
    const response = await GET(new Request(
      "https://gwstore.vercel.app/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar&ref=22222222-2222-4222-8222-222222222222",
    ));

    expect(response.status).toBe(307);
    expect(mocks.getGiveawayOAuthContext).toHaveBeenCalledWith("abc123def456", null);
    expect(mocks.createGiveawayOAuthState).toHaveBeenCalledWith({
      giveawayId: giveaway.id,
      slug: giveaway.slug,
      referralToken: null,
      intent: "view",
    }, "signed-state-secret");
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "discord",
      options: {
        redirectTo: "https://gwstore.vercel.app/api/sorteios/oauth/retorno?state=signed-state",
        scopes: "identify",
      },
    });
  });

  it("mantém o OAuth de participação e entrada no servidor para links de indicação", async () => {
    const referralToken = "22222222-2222-4222-8222-222222222222";
    await GET(new Request(
      `https://gwstore.vercel.app/api/sorteios/oauth/iniciar?slug=abc123def456&ref=${referralToken}`,
    ));

    expect(mocks.getGiveawayOAuthContext).toHaveBeenCalledWith(
      "abc123def456",
      referralToken,
    );
    expect(mocks.createGiveawayOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "participate", referralToken }),
      "signed-state-secret",
    );
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ scopes: "identify guilds.join" }),
      }),
    );
  });
});
