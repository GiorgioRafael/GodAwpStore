import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(() => null),
}));

import {
  DiscordTicketCloseClaimSupersededError,
  SupabaseDiscordTicketCloseReconciliationRepository,
  reconcileDiscordTicketCloseClaims,
  type DiscordTicketCloseReconciliationCandidate,
  type DiscordTicketCloseReconciliationRepository,
} from "./discord-ticket-close-reconciliation";

const now = Date.parse("2026-07-19T18:00:00.000Z");
const applicationId = "123456789012345678";
type MockFetcher = typeof fetch & ReturnType<typeof vi.fn>;
const candidate: DiscordTicketCloseReconciliationCandidate = {
  orderId: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
  discordGuildId: "223456789012345678",
  ticketChannelId: "323456789012345678",
  claimToken: "6bc34461-3e2d-4af2-bd2d-b42150704897",
  claimedAt: new Date(now - 6 * 60 * 1_000).toISOString(),
};

beforeEach(() => {
  vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "discord-bot-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Discord ticket close reconciliation", () => {
  it("renova a reserva exata no RPC antes de reconciliar", async () => {
    const single = vi.fn(async () => ({
      data: {
        renewed_order_id: candidate.orderId,
        renewed: true,
        active: false,
        ticket_status: "open",
        ticket_channel_id: candidate.ticketChannelId,
        claim_expires_at: new Date(now + 5 * 60 * 1_000).toISOString(),
      },
      error: null,
    }));
    const rpc = vi.fn(() => ({ single }));
    const repository = new SupabaseDiscordTicketCloseReconciliationRepository({
      rpc,
    } as never);

    await expect(repository.renew(candidate)).resolves.toBe("renewed");

    expect(rpc).toHaveBeenCalledWith("renew_discord_ticket_close_claim", {
      p_order_id: candidate.orderId,
      p_ticket_channel_id: candidate.ticketChannelId,
      p_claim_token: candidate.claimToken,
    });
  });

  it("atribui a conclusão ao worker de reconciliação no RPC", async () => {
    const single = vi.fn(async () => ({
      data: {
        completed_order_id: candidate.orderId,
        was_closed: true,
        ticket_status: "closed",
        ticket_channel_id: candidate.ticketChannelId,
        closed_at: new Date(now).toISOString(),
        closed_by_discord_user_id: "911402638975844354",
      },
      error: null,
    }));
    const rpc = vi.fn(() => ({ single }));
    const repository = new SupabaseDiscordTicketCloseReconciliationRepository({
      rpc,
    } as never);

    await expect(repository.complete(candidate)).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith("complete_discord_ticket_close", {
      p_order_id: candidate.orderId,
      p_ticket_channel_id: candidate.ticketChannelId,
      p_claim_token: candidate.claimToken,
      p_completion_source: "discord_close_reconciliation",
    });
  });

  it("rejeita uma confirmacao RPC que nao corresponde ao pedido", async () => {
    const single = vi.fn(async () => ({
      data: {
        completed_order_id: "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
        was_closed: true,
        ticket_status: "closed",
        ticket_channel_id: candidate.ticketChannelId,
        closed_at: new Date(now).toISOString(),
        closed_by_discord_user_id: "911402638975844354",
      },
      error: null,
    }));
    const repository = new SupabaseDiscordTicketCloseReconciliationRepository({
      rpc: vi.fn(() => ({ single })),
    } as never);

    await expect(repository.complete(candidate)).rejects.toThrow(
      "conclusao de fechamento invalida",
    );
  });

  it("rejeita uma renovacao RPC com canal divergente", async () => {
    const single = vi.fn(async () => ({
      data: {
        renewed_order_id: candidate.orderId,
        renewed: true,
        active: false,
        ticket_status: "open",
        ticket_channel_id: "923456789012345678",
        claim_expires_at: new Date(now + 5 * 60 * 1_000).toISOString(),
      },
      error: null,
    }));
    const repository = new SupabaseDiscordTicketCloseReconciliationRepository({
      rpc: vi.fn(() => ({ single })),
    } as never);

    await expect(repository.renew(candidate)).rejects.toThrow(
      "renovacao de fechamento invalida",
    );
  });

  it("conclui com o mesmo token somente diante de 404 Unknown Channel", async () => {
    const repository = fakeRepository([candidate]);
    const fetcher = discordFetcher({ channelStatus: 404 });

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toEqual({
      scanned: 1,
      completed: 1,
      alreadyClosed: 0,
      resumed: 0,
      superseded: 0,
      active: 0,
      failed: 0,
    });

    expect(repository.complete).toHaveBeenCalledWith(candidate);
    expect(repository.renew).toHaveBeenCalledWith(candidate);
    expect(requestMethods(fetcher)).toEqual([
      "GET /users/@me",
      `GET /guilds/${candidate.discordGuildId}`,
      `GET /channels/${candidate.ticketChannelId}`,
      `GET /guilds/${candidate.discordGuildId}`,
    ]);
  });

  it.each([
    ["HTML", "html" as const],
    ["outro código", { code: 10_008, message: "Unknown Message" }],
  ])("não conclui para 404 %s", async (_label, channelErrorBody) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);

    await expect(
      reconcileDiscordTicketCloseClaims({
        repository,
        fetcher: discordFetcher({ channelStatus: 404, channelErrorBody }),
        now: () => now,
      }),
    ).resolves.toMatchObject({ scanned: 1, completed: 0, resumed: 0, failed: 1 });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(candidate.orderId));
  });

  it("retoma o DELETE de uma reserva expirada e então conclui", async () => {
    const repository = fakeRepository([candidate]);
    const fetcher = discordFetcher();

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({
      scanned: 1,
      resumed: 1,
      completed: 1,
      active: 0,
      failed: 0,
    });

    expect(repository.complete).toHaveBeenCalledWith(candidate);
    expect(requestMethods(fetcher)).toContain(`DELETE /channels/${candidate.ticketChannelId}`);
  });

  it("aceita Unknown Channel idempotente no DELETE retomado", async () => {
    const repository = fakeRepository([candidate]);

    await expect(
      reconcileDiscordTicketCloseClaims({
        repository,
        fetcher: discordFetcher({ deleteStatus: 404 }),
        now: () => now,
      }),
    ).resolves.toMatchObject({ resumed: 1, completed: 1, failed: 0 });
  });

  it("preserva a claim quando DELETE 2xx não confirma o ID do canal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);

    await expect(
      reconcileDiscordTicketCloseClaims({
        repository,
        fetcher: discordFetcher({ deleteSuccessBody: {} }),
        now: () => now,
      }),
    ).resolves.toMatchObject({ resumed: 0, completed: 0, failed: 1 });

    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("preserva a reserva ativa quando o canal ainda existe", async () => {
    const activeCandidate = {
      ...candidate,
      claimedAt: new Date(now - 4 * 60 * 1_000).toISOString(),
    };
    const repository = fakeRepository([activeCandidate]);
    const fetcher = discordFetcher();

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({ scanned: 1, active: 1, resumed: 0, failed: 0 });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.renew).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).toEqual(["GET /users/@me"]);
    expect(requestMethods(fetcher)).not.toContain(
      `DELETE /channels/${candidate.ticketChannelId}`,
    );
  });

  it.each([
    ["guild", { guild_id: "923456789012345678" }],
    ["tópico", { topic: "gwstore-order:7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f" }],
    ["tipo", { type: 2 }],
  ])("não apaga canal com %s divergente", async (_label, override) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);
    const fetcher = discordFetcher({ channel: { ...validChannel(), ...override } });

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({ failed: 1, resumed: 0, completed: 0 });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).not.toContain(
      `DELETE /channels/${candidate.ticketChannelId}`,
    );
  });

  it.each([
    [403, { code: 50_001, message: "Missing Access" }],
    [404, { code: 10_008, message: "Unknown Message" }],
  ])("não conclui quando DELETE retorna %s sem Unknown Channel", async (deleteStatus, deleteErrorBody) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);

    await expect(
      reconcileDiscordTicketCloseClaims({
        repository,
        fetcher: discordFetcher({ deleteStatus, deleteErrorBody }),
        now: () => now,
      }),
    ).resolves.toMatchObject({ failed: 1, resumed: 0, completed: 0 });

    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("não interpreta ausência quando o bot autenticado diverge do aplicativo", async () => {
    const repository = fakeRepository([candidate]);
    const fetcher = discordFetcher({
      botUser: { id: "623456789012345678", bot: true },
      channelStatus: 404,
    });

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).rejects.toThrow("não corresponde ao aplicativo Discord");

    expect(repository.complete).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).toEqual(["GET /users/@me"]);
  });

  it.each([
    [403, { code: 50_001, message: "Missing Access" }],
    [404, { code: 10_003, message: "Unknown Channel" }],
  ])("não conclui nem apaga quando o guild retorna %s", async (guildStatus, guildErrorBody) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);
    const fetcher = discordFetcher({
      guildStatus,
      guildErrorBody,
      channelStatus: 404,
    });

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({
      scanned: 1,
      completed: 0,
      resumed: 0,
      failed: 1,
    });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).toEqual([
      "GET /users/@me",
      `GET /guilds/${candidate.discordGuildId}`,
    ]);
  });

  it("revalida o guild após Unknown Channel no GET antes da RPC", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);
    const fetcher = discordFetcher({
      channelStatus: 404,
      guildResponses: [
        { status: 200, body: { id: candidate.discordGuildId } },
        { status: 403, body: { code: 50_001, message: "Missing Access" } },
      ],
    });

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({ completed: 0, resumed: 0, failed: 1 });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).toEqual([
      "GET /users/@me",
      `GET /guilds/${candidate.discordGuildId}`,
      `GET /channels/${candidate.ticketChannelId}`,
      `GET /guilds/${candidate.discordGuildId}`,
    ]);
  });

  it("revalida o guild após Unknown Channel no DELETE antes da RPC", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);
    const fetcher = discordFetcher({
      deleteStatus: 404,
      guildResponses: [
        { status: 200, body: { id: candidate.discordGuildId } },
        { status: 403, body: { code: 50_001, message: "Missing Access" } },
      ],
    });

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({ completed: 0, resumed: 0, failed: 1 });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).toEqual([
      "GET /users/@me",
      `GET /guilds/${candidate.discordGuildId}`,
      `GET /channels/${candidate.ticketChannelId}`,
      `DELETE /channels/${candidate.ticketChannelId}`,
      `GET /guilds/${candidate.discordGuildId}`,
    ]);
  });

  it("isola guild inacessível sem bloquear outro guild e serializa checks únicos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const healthyCandidate: DiscordTicketCloseReconciliationCandidate = {
      ...candidate,
      orderId: "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
      discordGuildId: "423456789012345678",
      ticketChannelId: "523456789012345678",
      claimToken: "8bc34461-3e2d-4af2-bd2d-b42150704897",
    };
    const repository = fakeRepository([candidate, healthyCandidate]);
    const methods: string[] = [];
    let activeGuildChecks = 0;
    let maximumGuildChecks = 0;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      methods.push(`${method} ${url.pathname.replace("/api/v10", "")}`);
      if (url.pathname.endsWith("/users/@me")) {
        return Response.json({ id: applicationId, bot: true });
      }
      if (url.pathname.includes("/guilds/")) {
        activeGuildChecks += 1;
        maximumGuildChecks = Math.max(maximumGuildChecks, activeGuildChecks);
        await Promise.resolve();
        activeGuildChecks -= 1;
        if (url.pathname.endsWith(candidate.discordGuildId)) {
          return Response.json(
            { code: 50_001, message: "Missing Access" },
            { status: 403 },
          );
        }
        return Response.json({ id: healthyCandidate.discordGuildId });
      }
      if (url.pathname.endsWith(`/channels/${healthyCandidate.ticketChannelId}`)) {
        return Response.json(
          { code: 10_003, message: "Unknown Channel" },
          { status: 404 },
        );
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as MockFetcher;

    await expect(
      reconcileDiscordTicketCloseClaims({
        repository,
        fetcher,
        now: () => now,
        concurrency: 2,
      }),
    ).resolves.toMatchObject({ scanned: 2, completed: 1, failed: 1 });

    expect(repository.complete).toHaveBeenCalledOnce();
    expect(repository.complete).toHaveBeenCalledWith(healthyCandidate);
    expect(maximumGuildChecks).toBe(1);
    expect(methods).not.toContain(`GET /channels/${candidate.ticketChannelId}`);
    expect(methods).not.toContain(`DELETE /channels/${candidate.ticketChannelId}`);
  });

  it("não reconcilia sem application ID configurado", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "");
    const repository = fakeRepository([candidate]);
    const fetcher = discordFetcher({ channelStatus: 404 });

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).rejects.toThrow("DISCORD_APPLICATION_ID");

    expect(repository.complete).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).toEqual([]);
  });

  it("trata uma substituicao defensiva externa apos DELETE como superseded", async () => {
    const repository = fakeRepository([candidate]);
    repository.complete.mockRejectedValueOnce(
      new DiscordTicketCloseClaimSupersededError(),
    );

    await expect(
      reconcileDiscordTicketCloseClaims({
        repository,
        fetcher: discordFetcher(),
        now: () => now,
      }),
    ).resolves.toMatchObject({
      resumed: 1,
      superseded: 1,
      completed: 0,
      failed: 0,
    });
  });

  it("interrompe antes do Discord quando a renovacao CAS foi substituida", async () => {
    const repository = fakeRepository([candidate]);
    repository.renew.mockRejectedValueOnce(
      new DiscordTicketCloseClaimSupersededError(),
    );
    const fetcher = discordFetcher();

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({
      scanned: 1,
      superseded: 1,
      completed: 0,
      resumed: 0,
      failed: 0,
    });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).toEqual(["GET /users/@me"]);
  });

  it("nao duplica o DELETE quando outro cron ja renovou a mesma reserva", async () => {
    const repository = fakeRepository([candidate]);
    repository.renew.mockResolvedValueOnce("active");
    const fetcher = discordFetcher();

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({
      scanned: 1,
      active: 1,
      completed: 0,
      resumed: 0,
      failed: 0,
    });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(requestMethods(fetcher)).toEqual(["GET /users/@me"]);
  });

  it("rotaciona falhas antigas para que pedidos posteriores entrem no lote", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const claims: DiscordTicketCloseReconciliationCandidate[] = [
      {
        ...candidate,
        claimedAt: new Date(now - 8 * 60 * 1_000).toISOString(),
      },
      {
        ...candidate,
        orderId: "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
        ticketChannelId: "423456789012345678",
        claimToken: "8bc34461-3e2d-4af2-bd2d-b42150704897",
        claimedAt: new Date(now - 7 * 60 * 1_000).toISOString(),
      },
      {
        ...candidate,
        orderId: "8c6d4754-7b4f-4d2b-9f38-5df17ee3fc50",
        ticketChannelId: "523456789012345678",
        claimToken: "9cd45572-4f3e-4bf3-ad3e-c53261815908",
        claimedAt: new Date(now - 6 * 60 * 1_000).toISOString(),
      },
    ];
    const repository: DiscordTicketCloseReconciliationRepository = {
      listClaims: vi.fn(async (limit) =>
        [...claims]
          .sort((left, right) => left.claimedAt.localeCompare(right.claimedAt))
          .slice(0, limit),
      ),
      renew: vi.fn(async (input) => {
        const claim = claims.find((item) => item.claimToken === input.claimToken);
        if (!claim) throw new Error("claim ausente no teste");
        claim.claimedAt = new Date(now).toISOString();
        return "renewed" as const;
      }),
      complete: vi.fn(async () => true),
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/users/@me")) {
        return Response.json({ id: applicationId, bot: true });
      }
      if (path.endsWith(`/guilds/${candidate.discordGuildId}`)) {
        return Response.json({ id: candidate.discordGuildId });
      }
      if (path.includes("/channels/")) {
        return Response.json({ message: "Discord unavailable" }, { status: 503 });
      }
      throw new Error(`unexpected request ${path}`);
    }) as unknown as MockFetcher;

    const first = await reconcileDiscordTicketCloseClaims({
      repository,
      fetcher,
      now: () => now,
      limit: 2,
    });
    const second = await reconcileDiscordTicketCloseClaims({
      repository,
      fetcher,
      now: () => now,
      limit: 2,
    });

    expect(first).toMatchObject({ scanned: 2, failed: 2 });
    expect(second).toMatchObject({ scanned: 2, failed: 1, active: 1 });
    expect(repository.renew).toHaveBeenCalledTimes(3);
    expect(repository.renew).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderId: claims[2].orderId }),
    );
  });

  it("é idempotente depois que a primeira execução conclui o pedido", async () => {
    let pending = true;
    const repository = fakeRepository([]);
    repository.listClaims.mockImplementation(async () => (pending ? [candidate] : []));
    repository.complete.mockImplementation(async () => {
      pending = false;
      return true;
    });
    const fetcher = discordFetcher({ channelStatus: 404 });

    const first = await reconcileDiscordTicketCloseClaims({
      repository,
      fetcher,
      now: () => now,
    });
    const second = await reconcileDiscordTicketCloseClaims({
      repository,
      fetcher,
      now: () => now,
    });

    expect(first).toMatchObject({ scanned: 1, completed: 1, failed: 0 });
    expect(second).toMatchObject({ scanned: 0, completed: 0, failed: 0 });
    expect(repository.complete).toHaveBeenCalledOnce();
    expect(requestMethods(fetcher)).toEqual([
      "GET /users/@me",
      `GET /guilds/${candidate.discordGuildId}`,
      `GET /channels/${candidate.ticketChannelId}`,
      `GET /guilds/${candidate.discordGuildId}`,
    ]);
  });

  it("isola falhas do Discord sem apagar a evidência da reserva", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);

    await expect(
      reconcileDiscordTicketCloseClaims({
        repository,
        fetcher: discordFetcher({ channelStatus: 503 }),
        now: () => now,
      }),
    ).resolves.toMatchObject({ scanned: 1, failed: 1, completed: 0, resumed: 0 });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(candidate.orderId));
  });
});

function fakeRepository(
  claims: DiscordTicketCloseReconciliationCandidate[],
): DiscordTicketCloseReconciliationRepository & {
  listClaims: ReturnType<
    typeof vi.fn<DiscordTicketCloseReconciliationRepository["listClaims"]>
  >;
  complete: ReturnType<
    typeof vi.fn<DiscordTicketCloseReconciliationRepository["complete"]>
  >;
  renew: ReturnType<
    typeof vi.fn<DiscordTicketCloseReconciliationRepository["renew"]>
  >;
} {
  return {
    listClaims: vi.fn(async () => claims),
    renew: vi.fn(async () => "renewed" as const),
    complete: vi.fn(async () => true),
  };
}

function validChannel() {
  return {
    id: candidate.ticketChannelId,
    guild_id: candidate.discordGuildId,
    type: 0,
    topic: `gwstore-order:${candidate.orderId};welcome=1`,
  };
}

function discordFetcher(
  options: {
    botUser?: { id: string; bot: boolean };
    guild?: { id: string };
    guildStatus?: number;
    guildErrorBody?: { code: number; message: string };
    guildResponses?: Array<{ status: number; body: unknown }>;
    channel?: ReturnType<typeof validChannel>;
    channelStatus?: number;
    channelErrorBody?: "html" | { code: number; message: string };
    deleteStatus?: number;
    deleteErrorBody?: { code: number; message: string };
    deleteSuccessBody?: unknown;
  } = {},
): MockFetcher {
  let guildResponseIndex = 0;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname.endsWith("/users/@me")) {
      return Response.json(options.botUser ?? { id: applicationId, bot: true });
    }
    if (url.pathname.endsWith(`/guilds/${candidate.discordGuildId}`)) {
      const sequencedResponse = options.guildResponses?.[guildResponseIndex++];
      if (sequencedResponse) {
        return Response.json(sequencedResponse.body, {
          status: sequencedResponse.status,
        });
      }
      const status = options.guildStatus ?? 200;
      return Response.json(
        status === 200
          ? (options.guild ?? { id: candidate.discordGuildId })
          : (options.guildErrorBody ?? { message: "Discord guild unavailable" }),
        { status },
      );
    }
    if (url.pathname.endsWith(`/channels/${candidate.ticketChannelId}`) && method === "GET") {
      const status = options.channelStatus ?? 200;
      if (status !== 200) {
        if (options.channelErrorBody === "html") {
          return new Response("upstream not found", {
            status,
            headers: { "content-type": "text/html" },
          });
        }
        return Response.json(
          options.channelErrorBody ??
            (status === 404
              ? { code: 10_003, message: "Unknown Channel" }
              : { message: "Discord unavailable" }),
          { status },
        );
      }
      return Response.json(options.channel ?? validChannel());
    }
    if (url.pathname.endsWith(`/channels/${candidate.ticketChannelId}`) && method === "DELETE") {
      const status = options.deleteStatus ?? 200;
      return Response.json(
        status === 200
          ? (options.deleteSuccessBody ?? { id: candidate.ticketChannelId })
          : (options.deleteErrorBody ??
            (status === 404
              ? { code: 10_003, message: "Unknown Channel" }
              : { message: "Discord unavailable" })),
        { status },
      );
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as unknown as MockFetcher;
}

function requestMethods(fetcher: MockFetcher) {
  const calls = fetcher.mock.calls as Array<
    [input: string | URL | Request, init?: RequestInit]
  >;
  return calls.map(([input, init]) => {
    const url = new URL(String(input));
    return `${(init?.method ?? "GET").toUpperCase()} ${url.pathname.replace("/api/v10", "")}`;
  });
}
