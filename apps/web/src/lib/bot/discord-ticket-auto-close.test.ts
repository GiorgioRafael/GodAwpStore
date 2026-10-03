import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(() => null),
}));

import {
  SupabaseDiscordTicketAutoCloseRepository,
  reconcileDeliveredDiscordTicketAutoCloses,
  type DiscordTicketAutoCloseRepository,
} from "./discord-ticket-auto-close";
import type { DiscordTicketCloseReconciliationCandidate } from "./discord-ticket-close-reconciliation";

const applicationId = "123456789012345678";
const claim: DiscordTicketCloseReconciliationCandidate = {
  orderId: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
  discordGuildId: "1401264061101899820",
  ticketChannelId: "323456789012345678",
  claimToken: "6bc34461-3e2d-4af2-bd2d-b42150704897",
  claimedAt: "2026-07-27T18:00:00.000Z",
};

beforeEach(() => {
  vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "discord-bot-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Discord delivered-ticket automatic close", () => {
  it("reserva no RPC somente o lote solicitado", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          source: "orders",
          claimed_order_id: claim.orderId,
          discord_guild_id: claim.discordGuildId,
          ticket_channel_id: claim.ticketChannelId,
          claim_token: claim.claimToken,
          claimed_at: claim.claimedAt,
        },
      ],
      error: null,
    }));
    const repository = new SupabaseDiscordTicketAutoCloseRepository({ rpc } as never, { gwStoreOnly: true });

    await expect(repository.claimDue(25)).resolves.toEqual([claim]);
    expect(rpc).toHaveBeenCalledWith("claim_due_gwstore_discord_ticket_closes", {
      p_limit: 25,
    });
  });

  it("preserva a origem Robux da reserva e da conclusão automática", async () => {
    const rpc = vi.fn((name: string) => name.startsWith("claim_due") ? Promise.resolve({ data: [{
      source: "robux", claimed_order_id: claim.orderId, discord_guild_id: claim.discordGuildId,
      ticket_channel_id: claim.ticketChannelId, claim_token: claim.claimToken, claimed_at: claim.claimedAt,
    }], error: null }) : { single: async () => ({ data: {
      completed_order_id: claim.orderId, was_closed: true, ticket_status: "closed", ticket_channel_id: claim.ticketChannelId,
      closed_at: "2026-10-03T23:05:00.000Z", closed_by_discord_user_id: null,
    }, error: null }) });
    const repository = new SupabaseDiscordTicketAutoCloseRepository({ rpc } as never, { gwStoreOnly: true });
    const due = await repository.claimDue(25);
    expect(due).toEqual([{ ...claim, source: "robux" }]);
    expect(await repository.complete(due[0])).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("complete_robux_discord_ticket_close", {
      p_order_id: claim.orderId, p_ticket_channel_id: claim.ticketChannelId, p_claim_token: claim.claimToken,
    });
    const workerRepository = fakeRepository(due);
    await expect(reconcileDeliveredDiscordTicketAutoCloses({ repository: workerRepository, fetcher: discordFetcher([]) }))
      .resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(workerRepository.complete).toHaveBeenCalledWith({ ...claim, source: "robux" });
  });

  it.each([
    { source: "unexpected", discord_guild_id: claim.discordGuildId },
    { source: "robux", discord_guild_id: "923456789012345678" },
  ])("recusa origem ou servidor fora do contrato GW (%s)", async override => {
    const rpc = vi.fn(async () => ({ data: [{ claimed_order_id: claim.orderId,
      ticket_channel_id: claim.ticketChannelId, claim_token: claim.claimToken, claimed_at: claim.claimedAt, ...override }], error: null }));
    const repository = new SupabaseDiscordTicketAutoCloseRepository({ rpc } as never);
    await expect(repository.claimDue(25)).rejects.toThrow("reserva automática de fechamento inválida");
  });

  it("combina GW de itens e Robux com o saldo da fila legada de outros servidores", async () => {
    const item = { source: "orders", claimed_order_id: claim.orderId, discord_guild_id: claim.discordGuildId,
      ticket_channel_id: claim.ticketChannelId, claim_token: claim.claimToken, claimed_at: claim.claimedAt };
    const robux = { ...item, source: "robux", claimed_order_id: "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f" };
    const legacy = { ...item, source: undefined, claimed_order_id: "8b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f", discord_guild_id: "923456789012345678" };
    const rpc = vi.fn(async (name: string) => ({ data: name === "claim_due_gwstore_discord_ticket_closes" ? [item, robux] : [legacy], error: null }));
    const repository = new SupabaseDiscordTicketAutoCloseRepository({ rpc } as never);
    const result = await repository.claimDue(3);
    expect(result).toEqual([
      claim, { ...claim, source: "robux", orderId: robux.claimed_order_id },
      { ...claim, orderId: legacy.claimed_order_id, discordGuildId: legacy.discord_guild_id },
    ]);
    expect(rpc.mock.calls).toEqual([
      ["claim_due_gwstore_discord_ticket_closes", { p_limit: 3 }],
      ["claim_due_delivered_discord_ticket_closes", { p_limit: 1 }],
    ]);
  });

  it("não reserva a fila legada quando a GW já completou o limite compartilhado", async () => {
    const rpc = vi.fn(async () => ({ data: [{ source: "orders", claimed_order_id: claim.orderId,
      discord_guild_id: claim.discordGuildId, ticket_channel_id: claim.ticketChannelId,
      claim_token: claim.claimToken, claimed_at: claim.claimedAt }], error: null }));
    expect(await new SupabaseDiscordTicketAutoCloseRepository({ rpc } as never).claimDue(1)).toEqual([claim]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("claim_due_gwstore_discord_ticket_closes", { p_limit: 1 });
  });

  it("o job exclusivo GW nunca consulta a fila legada, mesmo com saldo vazio", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    expect(await new SupabaseDiscordTicketAutoCloseRepository({ rpc } as never, { gwStoreOnly: true }).claimDue(100)).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("claim_due_gwstore_discord_ticket_closes", { p_limit: 100 });
  });

  it("recusa Robux na resposta legada para não ampliar a fila de outros servidores", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "claim_due_gwstore_discord_ticket_closes" ? [] : [{
      source: "robux", claimed_order_id: claim.orderId, discord_guild_id: "923456789012345678",
      ticket_channel_id: claim.ticketChannelId, claim_token: claim.claimToken, claimed_at: claim.claimedAt,
    }], error: null }));
    await expect(new SupabaseDiscordTicketAutoCloseRepository({ rpc } as never).claimDue(1))
      .rejects.toThrow("reserva automática de fechamento inválida");
    expect(rpc.mock.calls).toEqual([
      ["claim_due_gwstore_discord_ticket_closes", { p_limit: 1 }],
      ["claim_due_delivered_discord_ticket_closes", { p_limit: 1 }],
    ]);
  });

  it("mantém o RPC antigo e o contrato sem source para outras lojas", async () => {
    vi.resetModules();
    vi.doMock("@/lib/brand", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/brand")>(), IS_GWSTORE: false }));
    try {
      const { SupabaseDiscordTicketAutoCloseRepository: OtherRepository } = await import("./discord-ticket-auto-close");
      const rpc = vi.fn(async () => ({ data: [{ claimed_order_id: claim.orderId, discord_guild_id: claim.discordGuildId,
        ticket_channel_id: claim.ticketChannelId, claim_token: claim.claimToken, claimed_at: claim.claimedAt }], error: null }));
      expect(await new OtherRepository({ rpc } as never).claimDue(25)).toEqual([claim]);
      expect(rpc).toHaveBeenCalledWith("claim_due_delivered_discord_ticket_closes", { p_limit: 25 });
    } finally { vi.doUnmock("@/lib/brand"); vi.resetModules(); }
  });

  it("apaga o canal validado e conclui a reserva automática", async () => {
    const repository = fakeRepository([claim]);
    const methods: string[] = [];
    const fetcher = discordFetcher(methods);

    await expect(
      reconcileDeliveredDiscordTicketAutoCloses({ repository, fetcher }),
    ).resolves.toEqual({
      claimed: 1,
      completed: 1,
      alreadyClosed: 0,
      removed: 1,
      superseded: 0,
      failed: 0,
    });

    expect(repository.complete).toHaveBeenCalledWith(claim);
    expect(methods).toEqual([
      "GET /users/@me",
      `GET /guilds/${claim.discordGuildId}`,
      `GET /channels/${claim.ticketChannelId}`,
      `DELETE /channels/${claim.ticketChannelId}`,
    ]);
  });

  it("não chama o Discord quando nenhum fechamento está vencido", async () => {
    const repository = fakeRepository([]);
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(
      reconcileDeliveredDiscordTicketAutoCloses({ repository, fetcher }),
    ).resolves.toEqual({
      claimed: 0,
      completed: 0,
      alreadyClosed: 0,
      removed: 0,
      superseded: 0,
      failed: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("mantém a reserva para reconciliação quando o Discord recusa o canal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([claim]);

    await expect(
      reconcileDeliveredDiscordTicketAutoCloses({
        repository,
        fetcher: discordFetcher([], { channelStatus: 403 }),
      }),
    ).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      removed: 0,
      failed: 1,
    });
    expect(repository.complete).not.toHaveBeenCalled();
  });
});

function fakeRepository(
  claims: DiscordTicketCloseReconciliationCandidate[],
): DiscordTicketAutoCloseRepository & {
  complete: ReturnType<typeof vi.fn<DiscordTicketAutoCloseRepository["complete"]>>;
} {
  return {
    claimDue: vi.fn(async () => claims),
    complete: vi.fn(async () => true),
  };
}

function discordFetcher(
  methods: string[],
  options: { channelStatus?: number } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace("/api/v10", "");
    methods.push(`${method} ${path}`);

    if (path === "/users/@me") {
      return Response.json({ id: applicationId, bot: true });
    }
    if (path === `/guilds/${claim.discordGuildId}`) {
      return Response.json({ id: claim.discordGuildId });
    }
    if (path === `/channels/${claim.ticketChannelId}` && method === "GET") {
      if (options.channelStatus && options.channelStatus !== 200) {
        return Response.json(
          { code: 50_001, message: "Missing Access" },
          { status: options.channelStatus },
        );
      }
      return Response.json({
        id: claim.ticketChannelId,
        guild_id: claim.discordGuildId,
        type: 0,
        topic: `gwstore-order:${claim.orderId};welcome=1`,
      });
    }
    if (path === `/channels/${claim.ticketChannelId}` && method === "DELETE") {
      return Response.json({ id: claim.ticketChannelId });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as unknown as typeof fetch;
}
