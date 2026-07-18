import "server-only";

import { decodeDiscordCustomId } from "@chat-adapter/discord";

import { getSiteUrl } from "@/lib/env";
import { getLivePixClient } from "@/lib/livepix/client";
import { MAXIMUM_ORDER_QUANTITY } from "@/lib/livepix/limits";
import { LivePixPaymentService } from "@/lib/livepix/payment-service";
import { SupabaseLivePixPaymentRepository } from "@/lib/livepix/supabase-repository";
import { BotCommerceService } from "./commerce-service";
import { fetchDiscordGuildIdentity, readDiscordInteraction } from "./discord-context";
import type { DiscordCartSelection } from "./discord-cart-selection";
import { decodeDiscordCartSelection } from "./discord-cart-selection";
import {
  cartPurchaseResultCard,
  updateDiscordEphemeralResponse,
} from "./discord-bot";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  type BotMessageCustomization,
} from "./message-customization";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import { MAXIMUM_CART_ITEMS } from "./types";

const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_MODAL_SUBMIT = 5;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_MODAL_RESPONSE = 9;
const CART_SELECT_ACTION = "select_products";
const CART_MODAL_PREFIX = "gwc:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NativeDiscordCartInteraction =
  | { kind: "open"; selections: DiscordCartSelection[] }
  | { kind: "submit"; response: Record<string, unknown> };

export function parseNativeDiscordCartInteraction(
  raw: unknown,
): NativeDiscordCartInteraction | null {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.type !== "number") return null;

  if (
    raw.type === DISCORD_MESSAGE_COMPONENT &&
    typeof raw.data.custom_id === "string" &&
    decodeDiscordCustomId(raw.data.custom_id).actionId === CART_SELECT_ACTION &&
    Array.isArray(raw.data.values)
  ) {
    const selections = raw.data.values.map(decodeDiscordCartSelection);
    const productIds = selections.flatMap((selection) =>
      selection ? [selection.productId] : [],
    );
    if (
      selections.some((selection) => !selection) ||
      productIds.length < 1 ||
      productIds.length > MAXIMUM_CART_ITEMS ||
      new Set(productIds).size !== productIds.length
    ) {
      return null;
    }
    return {
      kind: "open",
      selections: selections as DiscordCartSelection[],
    };
  }

  if (
    raw.type === DISCORD_MODAL_SUBMIT &&
    typeof raw.data.custom_id === "string" &&
    decodeCartProductIds(raw.data.custom_id)
  ) {
    return {
      kind: "submit",
      response: {
        type: DISCORD_DEFERRED_CHANNEL_MESSAGE,
        data: { flags: DISCORD_EPHEMERAL_FLAG },
      },
    };
  }

  return null;
}

export function createNativeDiscordCartResponse(selections: DiscordCartSelection[]) {
  const productIds = selections.map((selection) => selection.productId);
  if (
    productIds.length < 1 ||
    productIds.length > MAXIMUM_CART_ITEMS ||
    productIds.some((productId) => !UUID_PATTERN.test(productId)) ||
    new Set(productIds).size !== productIds.length
  ) {
    return discordEphemeralText("Seleção de produtos inválida. Abra a loja e tente novamente.");
  }

  return {
    type: DISCORD_MODAL_RESPONSE,
    data: {
      custom_id: encodeCartProductIds(productIds),
      title: `Quantidades (${productIds.length}/${productIds.length})`,
      components: selections.map((selection, index) => {
        return {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: `quantity_${index}`,
              label: truncate(selection.productName ?? `Produto ${index + 1}`, 45),
              style: 1,
              min_length: 1,
              max_length: String(MAXIMUM_ORDER_QUANTITY).length,
              required: true,
              value: "1",
              placeholder: `1 até ${MAXIMUM_ORDER_QUANTITY}`,
            },
          ],
        };
      }),
    },
  };
}

export async function completeDiscordCartPurchase(
  raw: unknown,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  let stockChanged = false;
  try {
    const context = readDiscordInteraction(raw, "");
    const items = readCartModalItems(raw);
    if (!context.interactionId || !context.guildId || !context.userId || !items) {
      await updateDiscordEphemeralResponse(
        raw,
        cartPurchaseResultCard({ kind: "invalid_request" }, null, customization),
      );
      return false;
    }

    const result = await new BotCommerceService(
      new SupabaseBotCommerceRepository(),
    ).purchaseCart({
      interactionId: context.interactionId,
      buyerDiscordId: context.userId,
      items,
      isServerBooster: context.isServerBooster,
      guild: await fetchDiscordGuildIdentity(context.guildId),
    });
    stockChanged = result.kind === "created";
    const checkoutUrl =
      result.kind === "created" || result.kind === "duplicate"
        ? (
            await new LivePixPaymentService(
              new SupabaseLivePixPaymentRepository(),
              getLivePixClient(),
            ).createCheckout(result.orderId, getSiteUrl())
          ).checkoutUrl
        : null;
    await updateDiscordEphemeralResponse(
      raw,
      cartPurchaseResultCard(result, checkoutUrl, customization),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-cart] ${message}`);
    await updateDiscordEphemeralResponse(
      raw,
      cartPurchaseResultCard({ kind: "invalid_request" }, null, customization),
    );
  }
  return stockChanged;
}

function encodeCartProductIds(productIds: string[]) {
  const encoded = productIds.map((productId) => {
    const normalized = productId.replaceAll("-", "");
    if (!UUID_PATTERN.test(productId) || normalized.length !== 32) {
      throw new Error("ID de produto inválido.");
    }
    return Buffer.from(normalized, "hex").toString("base64url");
  });
  const customId = `${CART_MODAL_PREFIX}${encoded.join(".")}`;
  if (customId.length > 100) throw new Error("Carrinho excede o limite do Discord.");
  return customId;
}

function decodeCartProductIds(customId: string) {
  if (!customId.startsWith(CART_MODAL_PREFIX)) return null;
  const encoded = customId.slice(CART_MODAL_PREFIX.length).split(".");
  if (encoded.length < 1 || encoded.length > MAXIMUM_CART_ITEMS) return null;
  try {
    const productIds = encoded.map((value) => {
      if (!/^[A-Za-z0-9_-]{22}$/.test(value)) throw new Error("ID compacto inválido.");
      const hex = Buffer.from(value, "base64url").toString("hex");
      if (hex.length !== 32) throw new Error("UUID compacto inválido.");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    });
    return productIds.every((productId) => UUID_PATTERN.test(productId)) &&
      new Set(productIds).size === productIds.length
      ? productIds
      : null;
  } catch {
    return null;
  }
}

function readCartModalItems(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.data.custom_id !== "string") {
    return null;
  }
  const productIds = decodeCartProductIds(raw.data.custom_id);
  if (!productIds || !Array.isArray(raw.data.components)) return null;
  const values = new Map<string, string>();
  visitComponents(raw.data.components, (component) => {
    if (typeof component.custom_id === "string" && typeof component.value === "string") {
      values.set(component.custom_id, component.value.trim());
    }
  });
  const items = productIds.map((productId, index) => {
    const value = values.get(`quantity_${index}`) ?? "";
    return {
      productId,
      quantity: /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN,
    };
  });
  return items.every(
    (item) =>
      Number.isInteger(item.quantity) &&
      item.quantity >= 1 &&
      item.quantity <= MAXIMUM_ORDER_QUANTITY,
  )
    ? items
    : null;
}

function visitComponents(
  value: unknown,
  visit: (component: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) visitComponents(item, visit);
    return;
  }
  if (!isObject(value)) return;
  visit(value);
  if (Array.isArray(value.components)) visitComponents(value.components, visit);
}

function discordEphemeralText(content: string) {
  return {
    type: 4,
    data: {
      content,
      flags: DISCORD_EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
    },
  };
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length - 3)}...`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
