import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcilePayment: vi.fn(),
  claimTicket: vi.fn(),
  completeTicket: vi.fn(),
  failTicket: vi.fn(),
  ensurePaidOrderTicket: vi.fn(),
}));

vi.mock("server-only", () => ({}));
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

import { POST } from "./route";

const clientId = "11111111-1111-4111-8111-111111111111";
const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
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
  });

  it("libera o lease e pede retry quando o Discord falha", async () => {
    vi.stubEnv("LIVEPIX_CLIENT_ID", clientId);
    mocks.reconcilePayment.mockResolvedValue({ orderId, orderStatus: "paid" });
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
