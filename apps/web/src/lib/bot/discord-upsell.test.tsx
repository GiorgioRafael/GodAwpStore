import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  cardToDiscordPayload,
  DiscordContentFormat,
} from "@chat-adapter/discord";
import { toCardElement } from "chat";

vi.mock("server-only", () => ({}));

const offer = {
  id: "11111111-1111-4111-8111-111111111111",
  productId: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
  productName: "Dragon Breath",
  unitPriceCents: 200,
  discountedUnitPriceCents: 190,
  discountBps: 500,
  expiresAt: "2026-07-24T21:05:00.000Z",
};

let parseNativeDiscordUpsellInteraction:
  typeof import("./discord-upsell").parseNativeDiscordUpsellInteraction;
let upsellOfferCard: typeof import("./discord-bot").upsellOfferCard;

beforeAll(async () => {
  ({ parseNativeDiscordUpsellInteraction } = await import("./discord-upsell"));
  ({ upsellOfferCard } = await import("./discord-bot"));
});

describe("upsell nativo do Discord", () => {
  it("mostra preço, economia e duas decisões explícitas", () => {
    const card = toCardElement(upsellOfferCard(offer));
    if (!card) throw new Error("Card de upsell inválido.");
    const payload = cardToDiscordPayload(card, {
      contentFormat: DiscordContentFormat.ComponentsV2,
    });
    const serialized = JSON.stringify(payload);

    expect(serialized).toContain("Oferta rápida antes do Pix");
    expect(serialized).toContain("R$ 1,90");
    expect(serialized).toContain("Adicionar oferta");
    expect(serialized).toContain("Continuar sem oferta");
  });

  it("decodifica aceitar e recusar sem confiar em preço vindo do botão", () => {
    const card = toCardElement(upsellOfferCard(offer));
    if (!card) throw new Error("Card de upsell inválido.");
    const payload = cardToDiscordPayload(card, {
      contentFormat: DiscordContentFormat.ComponentsV2,
    });
    const customIds: string[] = [];
    visit(payload, (value) => {
      if (typeof value.custom_id === "string") customIds.push(value.custom_id);
    });

    expect(customIds).toHaveLength(2);
    expect(
      parseNativeDiscordUpsellInteraction({
        type: 3,
        data: { custom_id: customIds[0] },
      }),
    ).toEqual({
      offerId: offer.id,
      accepted: true,
      response: { type: 6 },
    });
    expect(
      parseNativeDiscordUpsellInteraction({
        type: 3,
        data: { custom_id: customIds[1] },
      }),
    ).toEqual({
      offerId: offer.id,
      accepted: false,
      response: { type: 6 },
    });
  });

  it("rejeita IDs adulterados", () => {
    expect(
      parseNativeDiscordUpsellInteraction({
        type: 3,
        data: { custom_id: "gwstore_upsell_accept\n../../pedido" },
      }),
    ).toBeNull();
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
