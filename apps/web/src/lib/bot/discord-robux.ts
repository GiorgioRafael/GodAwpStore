import "server-only";

import { STORE_SLUG } from "@/lib/brand";
import { getRobuxPaymentService } from "@/lib/robux/payment-service";
import {
  formatRobuxQuantity,
  MAXIMUM_ROBUX_QUANTITY,
  MINIMUM_ROBUX_QUANTITY,
} from "@/lib/robux/pricing";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { readRobuxStorefrontConfiguration } from "./discord-robux-storefront";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_MODAL_SUBMIT = 5;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_MODAL_RESPONSE = 9;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const OPEN_CUSTOM_ID = "gwstore_robux:open";
const QUANTITY_MODAL_CUSTOM_ID = "gwstore_robux:quantity";
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export type NativeDiscordRobuxInteraction =
  | { kind: "open" }
  | { kind: "submit"; response: Record<string, unknown> };

export function parseNativeDiscordRobuxInteraction(
  raw: unknown,
): NativeDiscordRobuxInteraction | null {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.type !== "number") return null;
  if (raw.type === DISCORD_MESSAGE_COMPONENT && raw.data.custom_id === OPEN_CUSTOM_ID) {
    return { kind: "open" };
  }
  if (raw.type === DISCORD_MODAL_SUBMIT && raw.data.custom_id === QUANTITY_MODAL_CUSTOM_ID) {
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

export function createNativeDiscordRobuxResponse() {
  if (STORE_SLUG !== "gwstore") return robuxErrorResponse("Esta venda está disponível somente na GWStore.");
  return {
    type: DISCORD_MODAL_RESPONSE,
    data: {
      custom_id: QUANTITY_MODAL_CUSTOM_ID,
      title: "Comprar Robux",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "robux_quantity",
              label: "Quantidade de Robux",
              style: 1,
              min_length: 1,
              max_length: String(MAXIMUM_ROBUX_QUANTITY).length,
              required: true,
              placeholder: `${formatRobuxQuantity(MINIMUM_ROBUX_QUANTITY)} a ${formatRobuxQuantity(MAXIMUM_ROBUX_QUANTITY)}`,
            },
          ],
        },
      ],
    },
  };
}

export async function completeDiscordRobuxPurchase(raw: unknown) {
  try {
    if (STORE_SLUG !== "gwstore") {
      await updateDiscordRobuxResponse(raw, robuxErrorPayload("Esta venda está disponível somente na GWStore."));
      return;
    }
    const context = readDiscordContext(raw);
    if (!context) throw new Error("Abra a venda de Robux dentro do servidor da GWStore.");
    const configured = await isConfiguredRobuxChannel(context.guildId, context.channelId);
    if (!configured) {
      throw new Error("Esta mensagem de Robux não está mais ativa. Use a mensagem publicada pela loja.");
    }
    const quantity = readRobuxQuantity(raw);
    const checkout = await getRobuxPaymentService().createCheckout({
      discordGuildId: context.guildId,
      buyerDiscordId: context.userId,
      discordInteractionId: context.interactionId,
      robuxQuantity: quantity,
    });
    await updateDiscordRobuxResponse(raw, {
      embeds: [
        {
          color: 0x22c55e,
          title: "Pix gerado",
          description: `Você está comprando **${formatRobuxQuantity(quantity)} Robux** por **${formatBrl(checkout.amountCents)}**.`,
          footer: { text: "Pague pelo botão abaixo. Após a confirmação, seu ticket privado será aberto." },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Pagar com Pix",
              url: checkout.checkoutUrl,
            },
          ],
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível gerar seu Pix agora.";
    await updateDiscordRobuxResponse(raw, robuxErrorPayload(message)).catch((updateError) => {
      const fallback = updateError instanceof Error ? updateError.message : "erro desconhecido";
      console.error(`[discord-robux:reply] ${fallback}`);
    });
  }
}

function robuxErrorResponse(message: string) {
  return {
    type: 4,
    data: { ...robuxErrorPayload(message), flags: DISCORD_EPHEMERAL_FLAG },
  };
}

function robuxErrorPayload(message: string) {
  return {
    embeds: [
      {
        color: 0xef4444,
        title: "Não foi possível continuar",
        description: message,
      },
    ],
    components: [],
  };
}

async function isConfiguredRobuxChannel(discordGuildId: string, channelId: string) {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("A configuração da loja está indisponível.");
  const { data, error } = await client
    .from("guilds")
    .select("configuration")
    .eq("discord_guild_id", discordGuildId)
    .eq("status", "active")
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error("Não foi possível validar a mensagem de Robux.");
  return readRobuxStorefrontConfiguration(data?.configuration ?? {})?.channel_id === channelId;
}

async function updateDiscordRobuxResponse(raw: unknown, payload: Record<string, unknown>) {
  if (!isObject(raw)) throw new Error("Interação Discord inválida.");
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const applicationId = typeof raw.application_id === "string" ? raw.application_id : "";
  const token = typeof raw.token === "string" ? raw.token : "";
  if (
    !configuredApplicationId ||
    applicationId !== configuredApplicationId ||
    !SNOWFLAKE_PATTERN.test(applicationId) ||
    !/^[A-Za-z0-9._-]{20,500}$/.test(token)
  ) {
    throw new Error("Interação Discord incompleta.");
  }
  const apiUrl = (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(/\/$/, "");
  const response = await fetch(
    `${apiUrl}/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`Discord recusou a resposta de Robux (${response.status}).`);
}

function readDiscordContext(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.member) || !isObject(raw.member.user)) return null;
  const interactionId = typeof raw.id === "string" ? raw.id : "";
  const guildId = typeof raw.guild_id === "string" ? raw.guild_id : "";
  const channelId = typeof raw.channel_id === "string" ? raw.channel_id : "";
  const userId = typeof raw.member.user.id === "string" ? raw.member.user.id : "";
  if (![interactionId, guildId, channelId, userId].every((value) => SNOWFLAKE_PATTERN.test(value))) {
    return null;
  }
  return { interactionId, guildId, channelId, userId };
}

function readRobuxQuantity(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.data)) throw new Error("Quantidade de Robux inválida.");
  const value = findComponentValue(raw.data.components, "robux_quantity");
  if (!value || !/^[0-9]{1,6}$/.test(value.trim())) {
    throw new Error("Digite uma quantidade inteira de Robux.");
  }
  const quantity = Number(value.trim());
  if (quantity < MINIMUM_ROBUX_QUANTITY || quantity > MAXIMUM_ROBUX_QUANTITY) {
    throw new Error(
      `Escolha entre ${formatRobuxQuantity(MINIMUM_ROBUX_QUANTITY)} e ${formatRobuxQuantity(MAXIMUM_ROBUX_QUANTITY)} Robux.`,
    );
  }
  return quantity;
}

function findComponentValue(value: unknown, customId: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findComponentValue(item, customId);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  if (value.custom_id === customId && typeof value.value === "string") return value.value;
  return findComponentValue(value.components, customId);
}

function formatBrl(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
