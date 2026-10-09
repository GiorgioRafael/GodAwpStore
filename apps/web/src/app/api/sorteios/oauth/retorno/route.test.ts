import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addDiscordGuildMember: vi.fn(),
  getDiscordGuildMembership: vi.fn(),
  fetchDiscordOAuthUser: vi.fn(),
  verifyGiveawayOAuthState: vi.fn(),
  getGiveawayOAuthContext: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand", () => ({ IS_GWSTORE: true }));

vi.mock("@/lib/giveaways/discord-membership", () => ({
  addDiscordGuildMember: mocks.addDiscordGuildMember,
  getDiscordGuildMembership: mocks.getDiscordGuildMembership,
}));
vi.mock("@/lib/giveaways/discord-oauth", () => ({
  discordAccountCreatedAt: () => new Date("2020-01-01T00:00:00.000Z"),
  discordAvatarUrl: () => "https://cdn.example/avatar.png",
  discordDisplayName: () => "Invitee",
  fetchDiscordOAuthUser: mocks.fetchDiscordOAuthUser,
}));
vi.mock("@/lib/giveaways/oauth-state", () => ({
  GIVEAWAY_OAUTH_COOKIE: "gw_giveaway_oauth_state",
  giveawayEntryCookieName: (slug: string) => `gw_giveaway_entry_${slug}`,
  getGiveawayOAuthStateSecret: () => "secret",
  verifyGiveawayOAuthState: mocks.verifyGiveawayOAuthState,
}));
vi.mock("@/lib/giveaways/repository", () => ({
  getGiveawayOAuthContext: mocks.getGiveawayOAuthContext,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(() => ({ rpc: mocks.rpc, from: mocks.from })),
}));

import { GET } from "./route";

const giveaway = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "abc123def456",
  discordGuildId: "123456789012345678",
  startsAt: "2026-07-20T00:00:00.000Z",
  endsAt: "2099-07-21T00:00:00.000Z",
  status: "active" as const,
  minimumAccountAgeDays: 7,
  minimumStayMinutes: 60,
  referralEntryId: "22222222-2222-4222-8222-222222222222",
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gwstoreofc.com");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  mocks.verifyGiveawayOAuthState.mockReturnValue({
    giveawayId: giveaway.id,
    slug: giveaway.slug,
    referralToken: "33333333-3333-4333-8333-333333333333",
    intent: "participate",
  });
  mocks.getGiveawayOAuthContext.mockResolvedValue(giveaway);
  mocks.exchangeCodeForSession.mockResolvedValue({
    data: { session: { provider_token: "discord-access-token" } },
    error: null,
  });
  mocks.fetchDiscordOAuthUser.mockResolvedValue({ id: "423456789012345678" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("giveaway OAuth callback", () => {
  it.each(["https://gwstore-web-production.up.railway.app", "http://127.0.0.1:8080"])(
    "troca o código e volta ao sorteio legado com cookie privado pela ponte %s",
    async (actualOrigin) => {
      vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "test-environment");
      vi.stubEnv("RAILWAY_SERVICE_ID", "test-service");
      vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");
      vi.stubEnv("PORT", "8080");
      mocks.verifyGiveawayOAuthState.mockReturnValue({
        giveawayId: giveaway.id, slug: giveaway.slug, referralToken: null, intent: "view",
      });
      mocks.from.mockReturnValue(existingEntryQuery({ access_token: "private-entry-token" }));

      const response = await GET(new Request(`${actualOrigin}/api/sorteios/oauth/retorno?state=signed-state&code=oauth-code`, {
        headers: {
          host: "gwstore-web-production.up.railway.app",
          "x-gwstore-public-host": "gwstore.vercel.app",
          "x-forwarded-host": "gwstore-web-production.up.railway.app",
          "x-forwarded-proto": "https",
          cookie: "gw_giveaway_oauth_state=signed-state",
        },
      }));

      expect(response.headers.get("location"))
        .toBe("https://gwstore.vercel.app/sorteios/abc123def456?participacao=ja_cadastrado");
      expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
      expect(response.headers.get("set-cookie")).toContain("gw_giveaway_entry_abc123def456=private-entry-token");
      expect(response.headers.get("set-cookie")).not.toContain("Domain=");
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://gwstoreofc.com",
    "https://www.gwstoreofc.com",
    "https://gwstore.vercel.app",
  ])("conclui o OAuth e mantém a credencial privada na origem %s", async (origin) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin === "https://gwstore.vercel.app"
      ? "https://gwstoreofc.com" : "https://gwstore.vercel.app");
    mocks.verifyGiveawayOAuthState.mockReturnValue({
      giveawayId: giveaway.id,
      slug: giveaway.slug,
      referralToken: null,
      intent: "view",
    });
    mocks.from.mockReturnValue(existingEntryQuery({ access_token: "private-entry-token" }));

    const response = await GET(request(origin));

    expect(response.headers.get("location"))
      .toBe(`${origin}/sorteios/abc123def456?participacao=ja_cadastrado`);
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("gw_giveaway_oauth_state=;");
    expect(cookie).toContain("Path=/api/sorteios/oauth/retorno");
    expect(cookie).toContain("gw_giveaway_entry_abc123def456=private-entry-token");
    expect(cookie).toContain("Path=/sorteios/abc123def456");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["https://gwstoreofc.com", null],
    ["https://gwstoreofc.com", "different-state"],
    ["https://gwstore.vercel.app", null],
    ["https://gwstore.vercel.app", "different-state"],
  ])("rejeita estado sem cookie correspondente em %s (%s)", async (origin, cookieToken) => {
    const response = await GET(request(origin, cookieToken));

    expect(response.headers.get("location")).toBe(`${origin}/?erro=sessao_expirada`);
    expect(mocks.verifyGiveawayOAuthState).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redireciona o participante com token privado diferente do link de convite", async () => {
    mocks.verifyGiveawayOAuthState.mockReturnValue({
      giveawayId: giveaway.id,
      slug: giveaway.slug,
      referralToken: null,
      intent: "participate",
    });
    mocks.getGiveawayOAuthContext.mockResolvedValue({ ...giveaway, referralEntryId: null });
    mocks.getDiscordGuildMembership.mockResolvedValue({
      exists: true,
      pending: false,
      joinedAt: "2025-01-01T00:00:00.000Z",
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "register_giveaway_participant") {
        return single({
          entry_id: "55555555-5555-4555-8555-555555555555",
          referral_token: "66666666-6666-4666-8666-666666666666",
          valid_invite_count: 0,
          was_created: true,
        });
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    mocks.from.mockReturnValue(entryAccessQuery({
      access_token: "77777777-7777-4777-8777-777777777777",
    }));

    const response = await GET(request());
    const location = response.headers.get("location") ?? "";

    expect(location).toContain("participacao=cadastrado");
    expect(location).not.toContain("entrada=");
    expect(location).not.toContain("66666666-6666-4666-8666-666666666666");
    expect(response.headers.get("set-cookie")).toContain(
      "gw_giveaway_entry_abc123def456=77777777-7777-4777-8777-777777777777",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("avisa quando o participante já estava cadastrado", async () => {
    mocks.verifyGiveawayOAuthState.mockReturnValue({
      giveawayId: giveaway.id,
      slug: giveaway.slug,
      referralToken: null,
      intent: "participate",
    });
    mocks.getGiveawayOAuthContext.mockResolvedValue({ ...giveaway, referralEntryId: null });
    mocks.getDiscordGuildMembership.mockResolvedValue({
      exists: true,
      pending: false,
      joinedAt: "2025-01-01T00:00:00.000Z",
    });
    mocks.rpc.mockReturnValue(single({
      entry_id: "55555555-5555-4555-8555-555555555555",
      referral_token: "66666666-6666-4666-8666-666666666666",
      valid_invite_count: 0,
      was_created: false,
    }));
    mocks.from.mockReturnValue(entryAccessQuery({
      access_token: "77777777-7777-4777-8777-777777777777",
    }));

    const response = await GET(request());

    expect(response.headers.get("location")).toContain("participacao=ja_cadastrado");
  });

  it("consulta a participação sem cadastrar nem exigir que o sorteio esteja aberto", async () => {
    mocks.verifyGiveawayOAuthState.mockReturnValue({
      giveawayId: giveaway.id,
      slug: giveaway.slug,
      referralToken: null,
      intent: "view",
    });
    mocks.getGiveawayOAuthContext.mockResolvedValue({
      ...giveaway,
      status: "completed",
      endsAt: "2026-07-20T12:00:00.000Z",
    });
    mocks.from.mockReturnValue(existingEntryQuery({
      access_token: "77777777-7777-4777-8777-777777777777",
    }));

    const response = await GET(request());

    expect(response.headers.get("location")).toContain("participacao=ja_cadastrado");
    expect(response.headers.get("set-cookie")).toContain(
      "gw_giveaway_entry_abc123def456=77777777-7777-4777-8777-777777777777",
    );
    expect(mocks.getDiscordGuildMembership).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("informa quando o Discord identificado ainda não participa", async () => {
    mocks.verifyGiveawayOAuthState.mockReturnValue({
      giveawayId: giveaway.id,
      slug: giveaway.slug,
      referralToken: null,
      intent: "view",
    });
    mocks.from.mockReturnValue(existingEntryQuery(null));

    const response = await GET(request());

    expect(response.headers.get("location")).toContain("participacao=nao_cadastrado");
    expect(response.headers.get("set-cookie")).not.toContain("gw_giveaway_entry_abc123def456=");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("persiste o claim antes de adicionar o membro e conclui depois", async () => {
    const order: string[] = [];
    mocks.getDiscordGuildMembership.mockImplementation(async () => {
      order.push("membership");
      return { exists: false, pending: false, joinedAt: null };
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "prepare_giveaway_referral") {
        order.push("prepare");
        return single({
          referral_id: "44444444-4444-4444-8444-444444444444",
          referral_status: "pending",
          was_created: true,
          join_completed_at: null,
        });
      }
      if (name === "complete_giveaway_referral_join") {
        order.push("complete");
        return single({
          referral_id: "44444444-4444-4444-8444-444444444444",
          referral_status: "pending",
          was_completed: true,
        });
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
    mocks.addDiscordGuildMember.mockImplementation(async () => {
      order.push("discord-add");
      return {
        exists: true,
        pending: false,
        joinedAt: "2026-07-20T18:00:00.000Z",
        alreadyMember: false,
      };
    });

    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("convite=em_validacao");
    expect(order).toEqual(["membership", "prepare", "discord-add", "complete"]);
  });

  it("retoma um claim pendente quando o membro já entrou e não o adiciona novamente", async () => {
    mocks.getDiscordGuildMembership.mockResolvedValue({
      exists: true,
      pending: false,
      joinedAt: "2026-07-20T18:00:00.000Z",
    });
    mocks.from.mockReturnValue(referralClaimQuery({
      id: "44444444-4444-4444-8444-444444444444",
      referrer_entry_id: giveaway.referralEntryId,
      status: "pending",
      join_completed_at: null,
    }));
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "complete_giveaway_referral_join") {
        return single({
          referral_id: "44444444-4444-4444-8444-444444444444",
          referral_status: "pending",
          was_completed: true,
        });
      }
      throw new Error(`RPC inesperada: ${name}`);
    });

    const response = await GET(request());

    expect(response.headers.get("location")).toContain("convite=em_validacao");
    expect(mocks.addDiscordGuildMember).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("complete_giveaway_referral_join", expect.anything());
  });

  it("não remove o membro quando a conclusão no banco falha e permite retomada", async () => {
    mocks.getDiscordGuildMembership.mockResolvedValue({
      exists: false,
      pending: false,
      joinedAt: null,
    });
    mocks.addDiscordGuildMember.mockResolvedValue({
      exists: true,
      pending: false,
      joinedAt: "2026-07-20T18:00:00.000Z",
      alreadyMember: false,
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "prepare_giveaway_referral") {
        return single({
          referral_id: "44444444-4444-4444-8444-444444444444",
          referral_status: "pending",
          was_created: true,
          join_completed_at: null,
        });
      }
      return single(null, { message: "database timeout" });
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request());

    expect(response.headers.get("location")).toContain("erro=indisponivel");
    expect(mocks.addDiscordGuildMember).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();
  });
});

function request(origin = "https://gwstore.vercel.app", cookieToken: string | null = "signed-state") {
  return new Request(
    `${origin}/api/sorteios/oauth/retorno?state=signed-state&code=oauth-code`,
    { headers: cookieToken ? { cookie: `gw_giveaway_oauth_state=${cookieToken}` } : {} },
  );
}

function single<T>(data: T, error: { message: string } | null = null) {
  return { single: vi.fn().mockResolvedValue({ data, error }) };
}

function referralClaimQuery(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function entryAccessQuery(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function existingEntryQuery(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}
