import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  cardToDiscordPayload,
  DiscordContentFormat,
} from "@chat-adapter/discord";
import { toCardElement } from "chat";

vi.mock("server-only", () => ({}));

const claim = {
  id: "11111111-1111-4111-8111-111111111111",
  sourceOrderId: "22222222-2222-4222-8222-222222222222",
  buyerDiscordId: "123456789012345678",
  items: [
    {
      position: 1,
      productId: "33333333-3333-4333-8333-333333333333",
      productName: "Dragon Breath",
      quantity: 2,
      unitPriceCents: 300,
      subtotalPriceCents: 600,
      salePriceCents: 570,
      discountAmountCents: 30,
    },
  ],
  originalSalePriceCents: 570,
  recoveredSalePriceCents: 542,
  discountBps: 500,
  expiresAt: "2026-07-25T21:00:00.000Z",
};

let leadRecoveryOfferCard:
  typeof import("./lead-recovery").leadRecoveryOfferCard;
let parseNativeDiscordLeadRecoveryInteraction:
  typeof import("./lead-recovery").parseNativeDiscordLeadRecoveryInteraction;
let reconcileLeadRecoveryOffers:
  typeof import("./lead-recovery").reconcileLeadRecoveryOffers;

beforeAll(async () => {
  ({
    leadRecoveryOfferCard,
    parseNativeDiscordLeadRecoveryInteraction,
    reconcileLeadRecoveryOffers,
  } = await import("./lead-recovery"));
});

describe("recuperação de carrinho pelo Discord", () => {
  it("explica o QR novo, o desconto composto e apresenta decisões claras", () => {
    const card = toCardElement(leadRecoveryOfferCard(claim));
    if (!card) throw new Error("Card inválido.");
    const payload = cardToDiscordPayload(card, {
      contentFormat: DiscordContentFormat.ComponentsV2,
    });
    const serialized = JSON.stringify(payload);

    expect(serialized).toContain("Seu carrinho ainda está disponível");
    expect(serialized).toContain("R$ 5,42");
    expect(serialized).toContain("novo QR Pix com o novo valor");
    expect(serialized).toContain("Recuperar pedido");
    expect(serialized).toContain("Não quero");
  });

  it("vincula aceitar e recusar somente ao UUID persistido da oferta", () => {
    const card = toCardElement(leadRecoveryOfferCard(claim));
    if (!card) throw new Error("Card inválido.");
    const payload = cardToDiscordPayload(card, {
      contentFormat: DiscordContentFormat.ComponentsV2,
    });
    const customIds: string[] = [];
    visit(payload, (value) => {
      if (typeof value.custom_id === "string") customIds.push(value.custom_id);
    });

    expect(customIds).toHaveLength(2);
    expect(
      parseNativeDiscordLeadRecoveryInteraction({
        type: 3,
        data: { custom_id: customIds[0] },
      }),
    ).toEqual({
      offerId: claim.id,
      accepted: true,
      response: { type: 6 },
    });
    expect(
      parseNativeDiscordLeadRecoveryInteraction({
        type: 3,
        data: { custom_id: customIds[1] },
      }),
    ).toEqual({
      offerId: claim.id,
      accepted: false,
      response: { type: 6 },
    });
  });

  it("entrega por DM e confirma a mensagem usando a mesma claim", async () => {
    const completeDelivery = vi.fn(async () => true);
    const repository = {
      claimDeliveries: vi.fn(async () => [claim]),
      completeDelivery,
      failDelivery: vi.fn(async () => true),
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "223456789012345678" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "323456789012345678" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");

    const result = await reconcileLeadRecoveryOffers({
      repository: repository as never,
      fetcher,
    });

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://discord.com/api/v10/users/@me/channels",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recipient_id: claim.buyerDiscordId }),
      }),
    );
    const messageRequest = fetcher.mock.calls[1]?.[1];
    const messageBody = JSON.parse(String(messageRequest?.body));
    expect(messageBody).toMatchObject({
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
    });
    expect(completeDelivery).toHaveBeenCalledWith({
      offerId: claim.id,
      claimToken: expect.any(String),
      dmChannelId: "223456789012345678",
      dmMessageId: "323456789012345678",
    });
  });

  it("apaga a DM se o comprador cancelar enquanto a entrega está em voo", async () => {
    const failDelivery = vi.fn(async () => true);
    const repository = {
      claimDeliveries: vi.fn(async () => [claim]),
      completeDelivery: vi.fn(async () => false),
      failDelivery,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ id: "223456789012345678" }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: "323456789012345678" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");

    await expect(
      reconcileLeadRecoveryOffers({
        repository: repository as never,
        fetcher,
      }),
    ).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 });

    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "https://discord.com/api/v10/channels/223456789012345678/messages/323456789012345678",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(failDelivery).toHaveBeenCalledWith({
      offerId: claim.id,
      claimToken: expect.any(String),
      error: "A reserva da mensagem de recuperação expirou.",
    });
  });
});

function visit(value: unknown, callback: (value: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, callback));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  callback(object);
  Object.values(object).forEach((item) => visit(item, callback));
}
