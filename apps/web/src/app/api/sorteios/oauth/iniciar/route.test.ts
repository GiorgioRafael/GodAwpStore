import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGiveawayOAuthState: vi.fn(),
  getGiveawayOAuthContext: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getSiteUrl: () => "https://gwstore.vercel.app",
}));
vi.mock("@/lib/giveaways/oauth-state", () => ({
  GIVEAWAY_OAUTH_COOKIE: "gw_giveaway_oauth_state",
  createGiveawayOAuthState: mocks.createGiveawayOAuthState,
  getGiveawayOAuthStateSecret: () => "signed-state-secret",
}));
vi.mock("@/lib/giveaways/repository", () => ({
  getGiveawayOAuthContext: mocks.getGiveawayOAuthContext,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { signInWithOAuth: mocks.signInWithOAuth },
  })),
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
  mocks.getGiveawayOAuthContext.mockResolvedValue(giveaway);
  mocks.createGiveawayOAuthState.mockReturnValue("signed-state");
  mocks.signInWithOAuth.mockResolvedValue({
    data: { url: "https://discord.com/oauth2/authorize?state=signed-state" },
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("giveaway OAuth start", () => {
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
