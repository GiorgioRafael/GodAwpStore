import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/bot/message-customization-server", async () => {
  const { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } = await import("@/lib/bot/message-customization");
  return {
    loadBotRuntimeSettings: vi.fn(async () => ({
      customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ticketNotificationDiscordUserIds: [],
      ticketCloseAdminDiscordUserIds: [],
    })),
  };
});

import { ensurePaidOrderTicket } from "@/lib/bot/discord-ticket";
import { DiscordApiError } from "@/lib/bot/discord-api";
import type { DiscordPermissionOverwrite } from "@/lib/bot/discord-ticket-controls";
import type { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { recoverPaidOrderTicket, reconcilePaidOrderTickets, type PaidTicketCandidate } from "./paid-ticket-reconciliation";

type Client = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;
const instant = Date.parse("2026-10-08T03:10:00Z");
const candidate: PaidTicketCandidate = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  status: "paid", payment_status: "paid", paid_at: new Date(instant).toISOString(),
  discord_ticket_status: "not_created", discord_ticket_channel_id: null,
  discord_ticket_closed_at: null, stock_committed_at: new Date(instant).toISOString(), stock_released_at: null,
};
const claim = {
  orderId: candidate.id, claimed: true, discordGuildId: "123456789012345678",
  buyerDiscordId: "223456789012345678", productName: "Level · pacote de 100 níveis",
  quantity: 5, paidAmountCents: 1000, ticketStatus: "creating", existingChannelId: null,
};
const botId = "323456789012345678";
const channelId = "423456789012345678";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function dependencies() {
  const payments = {
    claimTicket: vi.fn(async () => claim),
    completeTicket: vi.fn(async () => undefined),
    failTicket: vi.fn(async () => undefined),
  };
  const openTicket = vi.fn<typeof ensurePaidOrderTicket>().mockResolvedValue({
    channelId, channelName: "ticket", created: true, welcomeMessageCreated: true, permissionsRepaired: false,
  });
  return { payments, openTicket };
}

describe("recuperação de tickets de itens e serviços pagos", () => {
  it("recupera UP pago preservando produto, quantidade e total sem reconciliar ou cobrar novamente", async () => {
    const deps = dependencies();
    expect(await recoverPaidOrderTicket(candidate, deps)).toBe("opened");
    expect(deps.openTicket).toHaveBeenCalledWith({
      orderId: candidate.id, guildId: claim.discordGuildId, buyerDiscordId: claim.buyerDiscordId,
      productName: claim.productName, quantity: 5, paidAmountCents: 1000,
    });
    expect(deps.payments.completeTicket).toHaveBeenCalledWith(candidate.id, channelId);
    expect(deps.payments.failTicket).not.toHaveBeenCalled();
  });

  it.each([
    { payment_reference: "web:550e8400-e29b-41d4-a716-446655440000" },
    { payment_status: "pending" }, { payment_status: "refunded" }, { paid_at: null },
    { status: "cancelled" }, { status: "refunded" },
    { discord_ticket_status: "closed" }, { discord_ticket_status: "open" },
    { discord_ticket_channel_id: channelId }, { discord_ticket_closed_at: new Date(instant).toISOString() },
    { stock_released_at: new Date(instant).toISOString() }, { stock_committed_at: null },
  ] as Array<Partial<PaidTicketCandidate>>)("não reabre um pedido inelegível (%j)", async overrides => {
    const deps = dependencies();
    expect(await recoverPaidOrderTicket({ ...candidate, ...overrides }, deps)).toBe("skipped");
    expect(deps.payments.claimTicket).not.toHaveBeenCalled();
    expect(deps.openTicket).not.toHaveBeenCalled();
  });

  it("deixa o banco decidir a reserva concorrente ou a lease ainda ativa", async () => {
    const deps = dependencies();
    deps.payments.claimTicket.mockResolvedValue({ ...claim, claimed: false });
    expect(await recoverPaidOrderTicket({ ...candidate, discord_ticket_status: "creating" }, deps)).toBe("skipped");
    expect(deps.openTicket).not.toHaveBeenCalled();
    expect(deps.payments.failTicket).not.toHaveBeenCalled();
  });

  it("libera uma falha de Discord e abre o mesmo pedido na próxima tentativa", async () => {
    const deps = dependencies();
    deps.openTicket.mockRejectedValueOnce(new Error("Discord indisponível"));
    await expect(recoverPaidOrderTicket(candidate, deps)).rejects.toThrow("Discord indisponível");
    expect(deps.payments.failTicket).toHaveBeenCalledWith(candidate.id);
    expect(await recoverPaidOrderTicket({ ...candidate, discord_ticket_status: "failed" }, deps)).toBe("opened");
    expect(deps.payments.completeTicket).toHaveBeenCalledOnce();
  });

  it("preserva o erro de entrega quando a liberação também falha", async () => {
    const deps = dependencies();
    deps.openTicket.mockRejectedValue(new Error("Discord indisponível"));
    deps.payments.failTicket.mockRejectedValue(new Error("Banco indisponível"));
    await expect(recoverPaidOrderTicket(candidate, deps)).rejects.toThrow("Discord indisponível");
  });

  it("recupera a conclusão perdida após criar o canal", async () => {
    const deps = dependencies();
    deps.payments.completeTicket.mockRejectedValueOnce(new Error("Banco indisponível"));
    await expect(recoverPaidOrderTicket(candidate, deps)).rejects.toThrow("Banco indisponível");
    expect(deps.payments.failTicket).toHaveBeenCalledWith(candidate.id);
    expect(await recoverPaidOrderTicket({ ...candidate, discord_ticket_status: "failed" }, deps)).toBe("opened");
    expect(deps.payments.completeTicket).toHaveBeenCalledTimes(2);
  });

  it.each(["channel", "welcome"])("recupera resposta perdida de %s sem duplicar canal ou mensagem", async lostResponse => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "ticket-test-token");
    let channel: { id: string; type: number; topic: string; permission_overwrites: DiscordPermissionOverwrite[] } | null = null;
    const messages: Array<{ id: string; author: { id: string }; embeds: unknown[] }> = [];
    let channelCreates = 0;
    let lost = false;
    const fetcher: typeof fetch = vi.fn(async (url, init) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (path.endsWith(`/guilds/${claim.discordGuildId}/channels`) && method === "GET") return Response.json(channel ? [channel] : []);
      if (path.endsWith("/users/@me")) return Response.json({ id: botId });
      if (path.endsWith(`/guilds/${claim.discordGuildId}/channels`) && method === "POST") {
        channelCreates += 1;
        channel = { id: channelId, type: 0, topic: body.topic, permission_overwrites: body.permission_overwrites };
        if (lostResponse === "channel" && !lost) { lost = true; throw new Error("Timeout após criar canal"); }
        return Response.json(channel, { status: 201 });
      }
      if (path.endsWith(`/channels/${channelId}/messages?limit=100`)) return Response.json(messages);
      if (path.endsWith(`/channels/${channelId}/messages`) && method === "POST") {
        messages.push({ id: "523456789012345678", author: { id: botId }, embeds: body.embeds });
        if (lostResponse === "welcome" && !lost) { lost = true; throw new Error("Timeout após criar mensagem"); }
        return Response.json(messages[0], { status: 201 });
      }
      if (path.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        channel = { ...channel!, ...body };
        return Response.json(channel);
      }
      throw new Error(`Requisição inesperada ${method} ${path}`);
    });
    const deps = dependencies();
    const openTicket: typeof ensurePaidOrderTicket = input => ensurePaidOrderTicket(input, { fetcher });

    await expect(recoverPaidOrderTicket(candidate, { ...deps, openTicket })).rejects.toThrow("Timeout");
    expect(await recoverPaidOrderTicket({ ...candidate, discord_ticket_status: "failed" }, { ...deps, openTicket })).toBe("opened");
    expect(channelCreates).toBe(1);
    expect(messages).toHaveLength(1);
    expect(deps.payments.completeTicket).toHaveBeenCalledOnce();
  });
});

describe("fila de recuperação de tickets pagos", () => {
  it("seleciona apenas tickets pagos sem canal e leases vencidas, em lotes de no máximo 15", async () => {
    const { client, query } = queryClient([candidate]);
    const deps = dependencies();
    expect(await reconcilePaidOrderTickets({ ...deps, client, now: () => instant, limit: 100 })).toEqual({
      checked: 1, opened: 1, skipped: 0, failed: 0, deferred: 0,
    });
    expect(query.eq).toHaveBeenCalledWith("payment_status", "paid");
    expect(query.in).toHaveBeenCalledWith("status", ["paid", "processing", "delivered"]);
    expect(query.in).toHaveBeenCalledWith("discord_ticket_status", ["not_created", "failed", "creating"]);
    expect(query.is).toHaveBeenCalledWith("discord_ticket_channel_id", null);
    expect(query.is).toHaveBeenCalledWith("discord_ticket_closed_at", null);
    expect(query.is).toHaveBeenCalledWith("stock_released_at", null);
    expect(query.not).toHaveBeenCalledWith("stock_committed_at", "is", null);
    expect(query.or).toHaveBeenCalledWith("discord_ticket_status.neq.creating,discord_ticket_claimed_at.is.null,discord_ticket_claimed_at.lte.2026-10-08T03:05:00.000Z");
    expect(query.or).toHaveBeenCalledWith("payment_reference.is.null,payment_reference.not.like.web:%");
    expect(query.order).toHaveBeenCalledWith("updated_at");
    expect(query.limit).toHaveBeenCalledWith(15);
    expect(query.update).toHaveBeenCalledWith({ updated_at: "2026-10-08T03:10:00.000Z" });
  });

  it("segue para o próximo comprador e gira falhas para não bloquear pedidos posteriores", async () => {
    const second = { ...candidate, id: "650e8400-e29b-41d4-a716-446655440000" };
    const { client, query } = queryClient([candidate, second]);
    const deps = dependencies();
    deps.payments.claimTicket.mockRejectedValueOnce(new Error("Carrinho incompleto"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await reconcilePaidOrderTickets({ ...deps, client, now: () => instant })).toEqual({
      checked: 2, opened: 1, skipped: 0, failed: 1, deferred: 0,
    });
    expect(query.update).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`[paid-ticket-recovery:${candidate.id}] Carrinho incompleto`));
  });

  it("deixa pedidos seguintes para o próximo ciclo após um minuto de trabalho", async () => {
    const { client } = queryClient([candidate, { ...candidate, id: "650e8400-e29b-41d4-a716-446655440000" }]);
    const deps = dependencies();
    let elapsed = 0;
    deps.openTicket.mockImplementation(async () => {
      elapsed = 60_000;
      return { channelId, channelName: "ticket", created: true, welcomeMessageCreated: true, permissionsRepaired: false };
    });
    expect(await reconcilePaidOrderTickets({ ...deps, client, now: () => instant + elapsed })).toEqual({
      checked: 1, opened: 1, skipped: 0, failed: 0, deferred: 1,
    });
    expect(deps.payments.claimTicket).toHaveBeenCalledOnce();
  });

  it("registra o código, rota e método de uma recusa do Discord", async () => {
    const { client } = queryClient([candidate]);
    const deps = dependencies();
    const path = `/guilds/${claim.discordGuildId}/channels`;
    deps.openTicket.mockRejectedValue(new DiscordApiError(400, path, "POST", 50035));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await reconcilePaidOrderTickets({ ...deps, client, now: () => instant })).toMatchObject({ checked: 1, failed: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`POST ${path}; código=50035`));
  });

  it("reporta indisponibilidade da consulta em vez de fingir fila vazia", async () => {
    const { client } = queryClient(null, { message: "Banco indisponível" });
    const deps = dependencies();
    await expect(reconcilePaidOrderTickets({ ...deps, client })).rejects.toThrow("consultar pedidos pagos");
    expect(deps.payments.claimTicket).not.toHaveBeenCalled();
  });
});

function queryClient(data: PaidTicketCandidate[] | null, error: { message: string } | null = null) {
  const query = {
    select: vi.fn(), update: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(), not: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
  for (const method of [query.select, query.update, query.eq, query.in, query.is, query.not, query.or, query.order, query.limit]) method.mockReturnValue(query);
  return { client: { from: vi.fn(() => query) } as unknown as Client, query };
}
