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
  discordGuildId: "223456789012345678",
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
          claimed_order_id: claim.orderId,
          discord_guild_id: claim.discordGuildId,
          ticket_channel_id: claim.ticketChannelId,
          claim_token: claim.claimToken,
          claimed_at: claim.claimedAt,
        },
      ],
      error: null,
    }));
    const repository = new SupabaseDiscordTicketAutoCloseRepository({ rpc } as never);

    await expect(repository.claimDue(25)).resolves.toEqual([claim]);
    expect(rpc).toHaveBeenCalledWith("claim_due_delivered_discord_ticket_closes", {
      p_limit: 25,
    });
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

  it("não chama o Discord quando nenhum ticket completou trinta minutos", async () => {
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
