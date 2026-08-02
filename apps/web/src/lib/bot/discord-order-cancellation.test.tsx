import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cardToDiscordPayload,
  DiscordContentFormat,
} from "@chat-adapter/discord";
import { toCardElement } from "chat";

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";

vi.mock("server-only", () => ({}));

const orderId = "cddc0f6c-d177-4435-9bf7-476380f0654c";
const guildId = "123456789012345678";
const buyerId = "223456789012345678";
const productId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";

let completeDiscordOrderCancellation:
  typeof import("./discord-order-cancellation").completeDiscordOrderCancellation;
let createNativeDiscordOrderRebuildResponse:
  typeof import("./discord-order-cancellation").createNativeDiscordOrderRebuildResponse;
let orderCancellationResultCard:
  typeof import("./discord-order-cancellation").orderCancellationResultCard;
let parseNativeDiscordOrderCancellationInteraction:
  typeof import("./discord-order-cancellation").parseNativeDiscordOrderCancellationInteraction;
let purchaseResultCard: typeof import("./discord-bot").purchaseResultCard;

beforeAll(async () => {
  ({
    completeDiscordOrderCancellation,
    createNativeDiscordOrderRebuildResponse,
    orderCancellationResultCard,
    parseNativeDiscordOrderCancellationInteraction,
  } = await import("./discord-order-cancellation"));
  ({ purchaseResultCard } = await import("./discord-bot"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cancelamento e reconstrução do pedido no Discord", () => {
  it("inclui cancelamento seguro em todo checkout Pix pendente", () => {
    const payload = discordPayload(
      purchaseResultCard(
        {
          kind: "created",
          orderId,
          productName: "Star Fruit",
          quantity: 10,
          unitPriceCents: 300,
          subtotalPriceCents: 3000,
          totalPriceCents: 3000,
          discountBps: 0,
          discountAmountCents: 0,
          discountReason: null,
        },
        "https://checkout.livepix.gg/reference",
      ),
    );
    const customIds = collectCustomIds(payload);
    expect(JSON.stringify(payload)).toContain("Cancelar e corrigir");
    expect(customIds).toHaveLength(1);
    expect(
      parseNativeDiscordOrderCancellationInteraction({
        type: 3,
        data: { custom_id: customIds[0] },
      }),
    ).toEqual({
      kind: "cancel",
      orderId,
      response: { type: 6 },
    });
  });

  it("cancela somente o pedido do comprador e oferece as duas correções", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "323456789012345678");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const cancel = vi.fn(async () => ({
      kind: "cancelled" as const,
      orderId,
      canRebuild: true as const,
      stockChanged: false,
      recoveryDm: null,
    }));
    const cancelCustomId = collectCustomIds(
      discordPayload(
        purchaseResultCard(
          {
            kind: "created",
            orderId,
            productName: "Star Fruit",
            quantity: 10,
            unitPriceCents: 300,
            subtotalPriceCents: 3000,
            totalPriceCents: 3000,
            discountBps: 0,
            discountAmountCents: 0,
            discountReason: null,
          },
          "https://checkout.livepix.gg/reference",
        ),
      ),
    )[0];

    await expect(
      completeDiscordOrderCancellation(
        interaction(cancelCustomId),
        {
          cancel,
          loadRebuildSelections: vi.fn(),
        },
      ),
    ).resolves.toBe(false);

    expect(cancel).toHaveBeenCalledWith({
      orderId,
      discordGuildId: guildId,
      buyerDiscordId: buyerId,
    });
    const responseBody = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(responseBody).toContain("Pedido cancelado");
    expect(responseBody).toContain("O estoque não foi consumido");
    expect(responseBody).toContain("Corrigir quantidades");
    expect(responseBody).toContain("Escolher outros produtos");
  });

  it("mantém cancelamento idempotente e vincula a reconstrução ao mesmo pedido", () => {
    const payload = discordPayload(
      orderCancellationResultCard({
        kind: "already_cancelled",
        orderId,
        canRebuild: true,
        stockChanged: false,
        recoveryDm: null,
      }),
    );
    const customIds = collectCustomIds(payload);
    expect(customIds).toHaveLength(2);
    expect(
      customIds.map((customId) =>
        parseNativeDiscordOrderCancellationInteraction({
          type: 3,
          data: { custom_id: customId },
        }),
      ),
    ).toEqual([
      { kind: "retry_quantities", orderId },
      { kind: "new_cart", orderId },
    ]);
  });

  it("abre novamente a vitrine limpa sem reaproveitar o pedido cancelado", async () => {
    const response = await createNativeDiscordOrderRebuildResponse(
      interaction("unused"),
      { kind: "new_cart", orderId },
      {
        cancellationRepository: {
          cancel: vi.fn(),
          loadRebuildSelections: vi.fn(async () => [
            { productId, productName: "Star Fruit" },
          ]),
        },
        commerceRepository: {
          listCatalog: vi.fn(async () => [
            {
              id: "game",
              name: "Grow a Garden 2",
              substores: [
                {
                  id: "substore",
                  name: "Seeds",
                  title: "Seeds",
                  description: "",
                  colorHex: "#D4AF37",
                  imageUrl: null,
                  products: [
                    {
                      id: productId,
                      name: "Star Fruit",
                      description: null,
                      priceCents: 300,
                      availableStock: 9,
                      sortOrder: 0,
                    },
                  ],
                },
              ],
            },
          ]),
        } as never,
        customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      },
    );

    expect(response).toMatchObject({ type: 7 });
    expect(JSON.stringify(response)).toContain("select_products");
    expect(JSON.stringify(response)).toContain("Star Fruit");
    expect(JSON.stringify(response)).not.toContain(orderId);
  });

  it("não oferece outro carrinho depois de um pagamento confirmado", () => {
    const payload = discordPayload(
      orderCancellationResultCard({
        kind: "payment_confirmed",
        orderId,
        canRebuild: false,
        stockChanged: false,
        recoveryDm: null,
      }),
    );
    expect(JSON.stringify(payload)).toContain("pagamento deste pedido já foi confirmado");
    expect(collectCustomIds(payload)).toHaveLength(0);
  });

  it("remove a oferta de recuperação já enviada quando o comprador cancela", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "323456789012345678");
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const cancel = vi.fn(async () => ({
      kind: "already_cancelled" as const,
      orderId,
      canRebuild: true as const,
      stockChanged: false as const,
      recoveryDm: {
        channelId: "523456789012345678",
        messageId: "623456789012345678",
      },
    }));

    const cancelCustomId = collectCustomIds(
      discordPayload(
        purchaseResultCard(
          {
            kind: "created",
            orderId,
            productName: "Star Fruit",
            quantity: 10,
            unitPriceCents: 300,
            subtotalPriceCents: 3000,
            totalPriceCents: 3000,
            discountBps: 0,
            discountAmountCents: 0,
            discountReason: null,
          },
          "https://checkout.livepix.gg/reference",
        ),
      ),
    )[0];

    await completeDiscordOrderCancellation(interaction(cancelCustomId), {
      cancel,
      loadRebuildSelections: vi.fn(),
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://discord.com/api/v10/channels/523456789012345678/messages/623456789012345678",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });
});

function interaction(customId: string) {
  return {
    type: 3,
    id: "423456789012345678",
    application_id: "323456789012345678",
    token: "interaction-token-for-test-123456",
    guild_id: guildId,
    channel_id: "523456789012345678",
    member: { user: { id: buyerId } },
    data: { custom_id: customId },
  };
}

function discordPayload(card: ReturnType<typeof toCardElement> | unknown) {
  const normalized = toCardElement(card as never);
  if (!normalized) throw new Error("Card Discord inválido.");
  return cardToDiscordPayload(normalized, {
    contentFormat: DiscordContentFormat.ComponentsV2,
  });
}

function collectCustomIds(value: unknown) {
  const customIds: string[] = [];
  visit(value, (item) => {
    if (typeof item.custom_id === "string") customIds.push(item.custom_id);
  });
  return customIds;
}

function visit(
  value: unknown,
  callback: (item: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  callback(value as Record<string, unknown>);
  for (const child of Object.values(value)) visit(child, callback);
}
