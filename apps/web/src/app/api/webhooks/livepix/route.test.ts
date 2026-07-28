import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcilePayment: vi.fn(),
  claimTicket: vi.fn(),
  completeTicket: vi.fn(),
  failTicket: vi.fn(),
  ensurePaidOrderTicket: vi.fn(),
  synchronizeDiscordCustomerRankRole: vi.fn(),
  requestDiscordStorefrontSync: vi.fn(),
  drainDiscordStorefrontSyncQueue: vi.fn(),
  reconcileRouletteSpin: vi.fn(),
  reconcileLatePaidOrderTickets: vi.fn(),
  afterTasks: [] as Array<() => void | Promise<void>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (callback: () => void | Promise<void>) => {
    mocks.afterTasks.push(callback);
  },
}));
vi.mock("@/lib/livepix/runtime", () => ({
  getLivePixPaymentService: () => ({
    reconcilePayment: mocks.reconcilePayment,
    claimTicket: mocks.claimTicket,
    completeTicket: mocks.completeTicket,
    failTicket: mocks.failTicket,
  }),
}));
vi.mock("@/lib/bot/discord-ticket", () => ({
  ensurePaidOrderTicket: mocks.ensurePaidOrderTicket,
}));
vi.mock("@/lib/bot/late-payment-ticket", () => ({
  reconcileLatePaidOrderTickets: mocks.reconcileLatePaidOrderTickets,
}));
vi.mock("@/lib/bot/discord-customer-rank", () => ({
  synchronizeDiscordCustomerRankRole: mocks.synchronizeDiscordCustomerRankRole,
}));
vi.mock("@/lib/bot/discord-storefront-sync-queue", () => ({
  requestDiscordStorefrontSync: mocks.requestDiscordStorefrontSync,
  drainDiscordStorefrontSyncQueue: mocks.drainDiscordStorefrontSyncQueue,
}));
vi.mock("@/lib/roulette/runtime", () => ({
  getRouletteCoinPurchaseService: () => ({
    reconcilePayment: mocks.reconcileRouletteSpin,
  }),
}));

import { POST } from "./route";

const clientId = "11111111-1111-4111-8111-111111111111";
const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  mocks.afterTasks.length = 0;
  mocks.requestDiscordStorefrontSync.mockResolvedValue(true);
  mocks.drainDiscordStorefrontSyncQueue.mockResolvedValue({
    claimed: 1,
    passes: 1,
    published: 1,
  });
});

describe("LivePix webhook route", () => {
  it("rejeita payload inválido antes de consultar serviços", async () => {
    const response = await POST(webhookRequest("{"));
    expect(response.status).toBe(400);
    expect(mocks.reconcilePayment).not.toHaveBeenCalled();
  });

  it("rejeita evento destinado a outro cliente OAuth", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", "21111111-1111-4111-8111-111111111111");
    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));
    expect(response.status).toBe(401);
    expect(mocks.reconcilePayment).not.toHaveBeenCalled();
  });

  it("confirma pagamento, cria ticket privado e conclui o lease", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue({
      orderId,
      orderStatus: "paid",
      firstConfirmation: true,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
    });
    mocks.claimTicket.mockResolvedValue({
      orderId,
      claimed: true,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
      productName: "Unicórnio",
      quantity: 2,
      paidAmountCents: 200,
      ticketStatus: "creating",
      existingChannelId: null,
    });
    mocks.ensurePaidOrderTicket.mockResolvedValue({ channelId: "323456789012345678" });
    mocks.completeTicket.mockResolvedValue(undefined);

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, ticket: "open" });
    expect(mocks.ensurePaidOrderTicket).toHaveBeenCalledWith({
      orderId,
      guildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
      productName: "Unicórnio",
      quantity: 2,
      paidAmountCents: 200,
    });
    expect(mocks.completeTicket).toHaveBeenCalledWith(orderId, "323456789012345678");
    expect(mocks.synchronizeDiscordCustomerRankRole).toHaveBeenCalledWith({
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
    });
    expect(mocks.requestDiscordStorefrontSync).toHaveBeenCalledWith(orderId);
    expect(mocks.drainDiscordStorefrontSyncQueue).not.toHaveBeenCalled();

    await runAfterTasks();
    expect(mocks.drainDiscordStorefrontSyncQueue).toHaveBeenCalledOnce();
  });

  it("abre um canal de recuperação quando o dinheiro cai depois do prazo", async () => {
    // Este caso já respondeu `not_applicable` e não fez mais nada: o comprador
    // era cobrado, não recebia o item e não tinha onde perguntar.
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue({
      orderId,
      orderStatus: "cancelled",
      firstConfirmation: true,
    });
    mocks.reconcileLatePaidOrderTickets.mockResolvedValue({
      pending: 1,
      opened: 1,
      failed: 0,
    });

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      ticket: "late_payment_recovery",
    });
    // O pedido continua cancelado: entregar ou devolver é decisão da equipe.
    expect(mocks.claimTicket).not.toHaveBeenCalled();
    expect(mocks.ensurePaidOrderTicket).not.toHaveBeenCalled();
    expect(mocks.requestDiscordStorefrontSync).not.toHaveBeenCalled();

    for (const task of mocks.afterTasks) await task();
    expect(mocks.reconcileLatePaidOrderTickets).toHaveBeenCalled();
  });

  it("continua abrindo o ticket quando só a sincronização do cargo falha", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue({
      orderId,
      orderStatus: "paid",
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
    });
    mocks.synchronizeDiscordCustomerRankRole.mockRejectedValue(
      new Error("Manage Roles ausente"),
    );
    mocks.claimTicket.mockResolvedValue({
      orderId,
      claimed: true,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
      productName: "Unicórnio",
      quantity: 1,
      paidAmountCents: 100,
      ticketStatus: "creating",
      existingChannelId: null,
    });
    mocks.ensurePaidOrderTicket.mockResolvedValue({ channelId: "323456789012345678" });

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, ticket: "open" });
    expect(mocks.completeTicket).toHaveBeenCalledWith(orderId, "323456789012345678");
  });

  it("usa replay do webhook para tentar novamente uma fila ainda pendente", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue({
      orderId,
      orderStatus: "paid",
      firstConfirmation: false,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
    });
    mocks.claimTicket.mockResolvedValue({
      orderId,
      claimed: false,
      ticketStatus: "open",
    });

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      ticket: "open",
    });
    expect(mocks.requestDiscordStorefrontSync).toHaveBeenCalledWith(orderId);
    await runAfterTasks();
    expect(mocks.drainDiscordStorefrontSyncQueue).toHaveBeenCalledOnce();
  });

  it("não repete o fanout quando a solicitação deste pedido já foi concluída", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue({
      orderId,
      orderStatus: "paid",
      firstConfirmation: false,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
    });
    mocks.requestDiscordStorefrontSync.mockResolvedValue(false);
    mocks.claimTicket.mockResolvedValue({
      orderId,
      claimed: false,
      ticketStatus: "open",
    });

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(200);
    expect(mocks.afterTasks).toHaveLength(0);
    expect(mocks.drainDiscordStorefrontSyncQueue).not.toHaveBeenCalled();
  });

  it("não bloqueia o ticket se a persistência da fila estiver indisponível", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue({
      orderId,
      orderStatus: "paid",
      firstConfirmation: true,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
    });
    mocks.requestDiscordStorefrontSync.mockRejectedValue(
      new Error("Supabase indisponível"),
    );
    mocks.claimTicket.mockResolvedValue({
      orderId,
      claimed: true,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
      productName: "Unicórnio",
      quantity: 1,
      paidAmountCents: 100,
      ticketStatus: "creating",
      existingChannelId: null,
    });
    mocks.ensurePaidOrderTicket.mockResolvedValue({
      channelId: "323456789012345678",
    });

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      ticket: "open",
    });
    expect(mocks.afterTasks).toHaveLength(0);
  });

  it("credita as moedas da roleta quando a referência não é de um pedido", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue(null);
    mocks.reconcileRouletteSpin.mockResolvedValue({
      purchaseId: "1a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
      status: "credited",
      creditedAmountCents: 300,
      coinBalanceCents: 300,
      firstConfirmation: true,
    });

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, roulette: "credited" });
    expect(mocks.claimTicket).not.toHaveBeenCalled();
  });

  it("ignora a referência que não pertence a pedido nem a compra de moedas", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue(null);
    mocks.reconcileRouletteSpin.mockResolvedValue(null);

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, ignored: true });
  });

  it("libera o lease e pede retry quando o Discord falha", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue({
      orderId,
      orderStatus: "paid",
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
    });
    mocks.claimTicket.mockResolvedValue({
      orderId,
      claimed: true,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
      productName: "Unicórnio",
      quantity: 2,
      paidAmountCents: 200,
      ticketStatus: "creating",
      existingChannelId: null,
    });
    mocks.ensurePaidOrderTicket.mockRejectedValue(new Error("Discord indisponível"));
    mocks.failTicket.mockResolvedValue(undefined);

    const response = await POST(webhookRequest(JSON.stringify(webhookPayload())));

    expect(response.status).toBe(503);
    expect(mocks.failTicket).toHaveBeenCalledWith(orderId);
    expect(mocks.completeTicket).not.toHaveBeenCalled();
  });
});

function webhookPayload() {
  return {
    userId: "61021c7bdabe5e001225b65b",
    clientId,
    event: "new",
    resource: {
      id: "61021c7bdabe5e001225b65c",
      reference: "61021c7bdabe5e001225b65d",
      type: "payment",
    },
  };
}

function webhookRequest(body: string) {
  return new Request("https://gwstore.vercel.app/api/webhooks/livepix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function runAfterTasks() {
  const tasks = mocks.afterTasks.splice(0);
  await Promise.all(tasks.map((task) => task()));
}
