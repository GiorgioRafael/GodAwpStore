import "server-only";

import { decodeDiscordCustomId } from "@chat-adapter/discord";
import { getSiteUrl } from "@/lib/env";
import { getLivePixClient } from "@/lib/livepix/client";
import { LivePixPaymentService } from "@/lib/livepix/payment-service";
import { SupabaseLivePixPaymentRepository } from "@/lib/livepix/supabase-repository";
import { BotCommerceService } from "./commerce-service";
import { readDiscordInteraction } from "./discord-context";
import {
  cartPurchaseResultCard,
  updateDiscordEphemeralResponse,
} from "./discord-bot";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  type BotMessageCustomization,
} from "./message-customization";
import { SupabaseBotCommerceRepository } from "./supabase-repository";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_DEFERRED_UPDATE_MESSAGE = 6;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCEPT_ACTION = "gwstore_upsell_accept";
const DECLINE_ACTION = "gwstore_upsell_decline";

export type NativeDiscordUpsellInteraction = {
  offerId: string;
  accepted: boolean;
  response: { type: 6 };
};

export function parseNativeDiscordUpsellInteraction(
  raw: unknown,
): NativeDiscordUpsellInteraction | null {
  if (
    !isObject(raw) ||
    raw.type !== DISCORD_MESSAGE_COMPONENT ||
    !isObject(raw.data) ||
    typeof raw.data.custom_id !== "string"
  ) {
    return null;
  }

  let decoded: ReturnType<typeof decodeDiscordCustomId>;
  try {
    decoded = decodeDiscordCustomId(raw.data.custom_id);
  } catch {
    return null;
  }
  if (decoded.actionId !== ACCEPT_ACTION && decoded.actionId !== DECLINE_ACTION) {
    return null;
  }
  const offerId = typeof decoded.value === "string"
    ? decoded.value.trim().toLowerCase()
    : "";
  if (!UUID_PATTERN.test(offerId)) return null;

  return {
    offerId,
    accepted: decoded.actionId === ACCEPT_ACTION,
    response: { type: DISCORD_DEFERRED_UPDATE_MESSAGE },
  };
}

export async function completeDiscordUpsellDecision(
  raw: unknown,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const parsed = parseNativeDiscordUpsellInteraction(raw);
  const context = readDiscordInteraction(raw, "");
  if (
    !parsed ||
    !context.interactionId ||
    !context.guildId ||
    !context.userId
  ) {
    await updateDiscordEphemeralResponse(
      raw,
      cartPurchaseResultCard({ kind: "invalid_request" }, null, customization),
    );
    return false;
  }

  try {
    const result = await new BotCommerceService(
      new SupabaseBotCommerceRepository(),
    ).finalizeUpsell({
      offerId: parsed.offerId,
      interactionId: context.interactionId,
      buyerDiscordId: context.userId,
      discordGuildId: context.guildId,
      accepted: parsed.accepted,
    });
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
    return result.kind === "created";
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-upsell] ${message}`);
    await updateDiscordEphemeralResponse(
      raw,
      cartPurchaseResultCard({ kind: "invalid_request" }, null, customization),
    );
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
