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
const CART_ADD_ACTION = "gwc:add";
const CART_CONTINUE_ACTION = "gwc:continue";
const CART_ITEM_PREFIX = "gwc:item:";
const CART_MODAL_PREFIX = "gwc:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DiscordCartOption = {
  label: string;
  value: string;
  description?: string;
};

export type NativeDiscordCartInteraction =
  | {
      kind: "review";
      responseType: 4 | 7;
      selections: DiscordCartSelection[];
      options: DiscordCartOption[];
    }
  | { kind: "open"; selections: DiscordCartSelection[] }
  | { kind: "submit"; response: Record<string, unknown> };

export function parseNativeDiscordCartInteraction(
  raw: unknown,
): NativeDiscordCartInteraction | null {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.type !== "number") return null;

  if (raw.type === DISCORD_MESSAGE_COMPONENT && typeof raw.data.custom_id === "string") {
    const actionId = readDiscordActionId(raw.data.custom_id);
    if (actionId === CART_SELECT_ACTION && Array.isArray(raw.data.values)) {
      const selections = decodeSelections(raw.data.values);
      if (!selections) return null;

      return {
        kind: "review",
        responseType: 4,
        selections,
        options: readCartOptions(raw, selections),
      };
    }

    if (raw.data.custom_id === CART_ADD_ACTION && Array.isArray(raw.data.values)) {
      const currentSelections = readSelectedCartItems(raw);
      const addedSelections = decodeSelections(raw.data.values);
      if (!currentSelections || !addedSelections || addedSelections.length !== 1) return null;

      const availableOptions = readCartOptions(raw);
      const addedSelection = addedSelections[0];
      const addedValue = raw.data.values[0];
      if (
        !addedSelection ||
        !availableOptions.some((option) => option.value === addedValue)
      ) {
        return null;
      }
      const selections = validateSelections([...currentSelections, addedSelection]);
      if (!selections) return null;

      return {
        kind: "review",
        responseType: 7,
        selections,
        options: availableOptions.filter(
          (option) => decodeDiscordCartSelection(option.value)?.productId !== addedSelection.productId,
        ),
      };
    }

    if (raw.data.custom_id === CART_CONTINUE_ACTION) {
      const selections = readSelectedCartItems(raw);
      return selections ? { kind: "open", selections } : null;
    }
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

export function createNativeDiscordCartReviewResponse(
  selections: DiscordCartSelection[],
  options: DiscordCartOption[],
  responseType: 4 | 7,
) {
  const validatedSelections = validateSelections(selections);
  if (!validatedSelections) {
    return discordEphemeralText("Seleção de produtos inválida. Abra a loja e tente novamente.");
  }

  const selectedIds = new Set(validatedSelections.map((selection) => selection.productId));
  const remainingOptions = options
    .filter((option) => {
      const selection = decodeDiscordCartSelection(option.value);
      return selection && !selectedIds.has(selection.productId);
    })
    .slice(0, 25);
  const canAddMore =
    validatedSelections.length < MAXIMUM_CART_ITEMS && remainingOptions.length > 0;
  const count = validatedSelections.length;

  return {
    type: responseType,
    data: {
      content:
        count === MAXIMUM_CART_ITEMS
          ? `🛒 **Carrinho: ${count}/${MAXIMUM_CART_ITEMS} produtos**\nTudo certo! Agora avance para definir as quantidades.`
          : `🛒 **Carrinho: ${count}/${MAXIMUM_CART_ITEMS} produtos**\n${
              canAddMore
                ? "Selecione mais um produto abaixo ou avance agora."
                : "Avance para definir as quantidades."
            }`,
      ...(responseType === 4 ? { flags: DISCORD_EPHEMERAL_FLAG } : {}),
      allowed_mentions: { parse: [] },
      components: [
        {
          type: 1,
          components: validatedSelections.map((selection, index) => ({
            type: 2,
            style: 2,
            custom_id: `${CART_ITEM_PREFIX}${encodeCompactProductId(selection.productId)}`,
            label: truncate(selection.productName ?? `Produto ${index + 1}`, 80),
            disabled: true,
          })),
        },
        ...(canAddMore
          ? [
              {
                type: 1,
                components: [
                  {
                    type: 3,
                    custom_id: CART_ADD_ACTION,
                    placeholder: `➕ Adicionar outro produto (${count}/${MAXIMUM_CART_ITEMS})`,
                    min_values: 1,
                    max_values: 1,
                    options: remainingOptions,
                  },
                ],
              },
            ]
          : []),
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              custom_id: CART_CONTINUE_ACTION,
              label: `Continuar com ${count} ${count === 1 ? "produto" : "produtos"}`,
            },
          ],
        },
      ],
    },
  };
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
  const encoded = productIds.map(encodeCompactProductId);
  const customId = `${CART_MODAL_PREFIX}${encoded.join(".")}`;
  if (customId.length > 100) throw new Error("Carrinho excede o limite do Discord.");
  return customId;
}

function encodeCompactProductId(productId: string) {
  const normalized = productId.replaceAll("-", "");
  if (!UUID_PATTERN.test(productId) || normalized.length !== 32) {
    throw new Error("ID de produto inválido.");
  }
  return Buffer.from(normalized, "hex").toString("base64url");
}

function decodeCompactProductId(value: string) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  const hex = Buffer.from(value, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const productId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_PATTERN.test(productId) ? productId : null;
}

function decodeCartProductIds(customId: string) {
  if (!customId.startsWith(CART_MODAL_PREFIX)) return null;
  const encoded = customId.slice(CART_MODAL_PREFIX.length).split(".");
  if (encoded.length < 1 || encoded.length > MAXIMUM_CART_ITEMS) return null;
  try {
    const productIds = encoded.map(decodeCompactProductId);
    return productIds.every((productId): productId is string => productId !== null) &&
      new Set(productIds).size === productIds.length
      ? productIds
      : null;
  } catch {
    return null;
  }
}

function decodeSelections(values: unknown[]) {
  const selections = values.map(decodeDiscordCartSelection);
  return selections.every((selection): selection is DiscordCartSelection => selection !== null)
    ? validateSelections(selections)
    : null;
}

function validateSelections(selections: DiscordCartSelection[]) {
  const productIds = selections.map((selection) => selection.productId);
  return productIds.length >= 1 &&
    productIds.length <= MAXIMUM_CART_ITEMS &&
    productIds.every((productId) => UUID_PATTERN.test(productId)) &&
    new Set(productIds).size === productIds.length
    ? selections
    : null;
}

function readDiscordActionId(customId: string) {
  try {
    return decodeDiscordCustomId(customId).actionId;
  } catch {
    return null;
  }
}

function readSelectedCartItems(raw: Record<string, unknown>) {
  if (!isObject(raw.message)) return null;
  const selections: DiscordCartSelection[] = [];
  visitComponents(raw.message.components, (component) => {
    if (
      component.type !== 2 ||
      typeof component.custom_id !== "string" ||
      !component.custom_id.startsWith(CART_ITEM_PREFIX) ||
      typeof component.label !== "string"
    ) {
      return;
    }
    const productId = decodeCompactProductId(
      component.custom_id.slice(CART_ITEM_PREFIX.length),
    );
    if (productId) {
      const label = component.label.trim();
      selections.push({
        productId,
        productName: truncate(label || `Produto ${selections.length + 1}`, 80),
      });
    }
  });
  return validateSelections(selections);
}

function readCartOptions(
  raw: Record<string, unknown>,
  selected: DiscordCartSelection[] = [],
) {
  if (!isObject(raw.message)) return [];
  const selectedIds = new Set(selected.map((selection) => selection.productId));
  const options: DiscordCartOption[] = [];
  visitComponents(raw.message.components, (component) => {
    if (component.type !== 3 || !Array.isArray(component.options)) return;
    for (const value of component.options) {
      if (!isObject(value) || typeof value.label !== "string" || typeof value.value !== "string") {
        continue;
      }
      const selection = decodeDiscordCartSelection(value.value);
      if (!selection || selectedIds.has(selection.productId)) continue;
      options.push({
        label: truncate(value.label, 100),
        value: value.value,
        ...(typeof value.description === "string"
          ? { description: truncate(value.description, 100) }
          : {}),
      });
    }
  });
  return options.slice(0, 25);
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
