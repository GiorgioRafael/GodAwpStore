import { IS_GWSTORE } from "@/lib/brand";
import type { BotRuntimeSettings } from "./message-customization-server";

export const GWSTORE_SELLING_GUILD_ID = "1401264061101899820";
export const GODAWP_DISCORD_USER_ID = "385924725332901909";
export const SELLING_ENTRY_TOPIC = "gwstore-item-selling:v1";
export const SELLING_ENTRY_TITLE = "📦 VENDA SEU ITEM PARA A GWSTORE";
export const SELLING_TICKET_TOPIC = "gwstore-item-offer:";
export const SELLING_OPEN_ID = "gwsell:open";
export const SELLING_SUBMIT_ID = "gwsell:submit";
export const SELLING_COMPLETE_PREFIX = "gwsell:complete:";
export const SNOWFLAKE = /^[0-9]{15,22}$/;

export type ItemSellingInteraction =
  | { kind: "open" }
  | { kind: "submit"; itemName: string | null }
  | { kind: "complete"; channelId: string };

export type ItemSellingContext = {
  interactionId: string;
  guildId: string;
  channelId: string;
  applicationId: string;
  userId: string;
  token: string;
};

export function parseItemSellingInteraction(raw: unknown): ItemSellingInteraction | null {
  if (!isObject(raw) || !isObject(raw.data)) return null;
  const id = raw.data.custom_id;
  if (raw.type === 3 && id === SELLING_OPEN_ID) return { kind: "open" };
  if (raw.type === 5 && id === SELLING_SUBMIT_ID) {
    const value = findInput(raw.data.components);
    const itemName = typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
    return { kind: "submit", itemName: itemName.length > 0 && itemName.length <= 120 ? itemName : null };
  }
  if (raw.type === 3 && typeof id === "string" && id.startsWith(SELLING_COMPLETE_PREFIX)) {
    const channelId = id.slice(SELLING_COMPLETE_PREFIX.length);
    return SNOWFLAKE.test(channelId) ? { kind: "complete", channelId } : null;
  }
  return null;
}

export function itemSellingContext(raw: unknown): ItemSellingContext | null {
  if (!isObject(raw) || !isObject(raw.member) || !isObject(raw.member.user)) return null;
  const { id, guild_id, channel_id, application_id, token } = raw;
  const userId = raw.member.user.id;
  if (![id, guild_id, channel_id, application_id, userId].every(value => typeof value === "string" && SNOWFLAKE.test(value))) return null;
  if (typeof token !== "string" || !/^[A-Za-z0-9._-]{20,500}$/.test(token)) return null;
  if (guild_id !== GWSTORE_SELLING_GUILD_ID || application_id !== process.env.DISCORD_APPLICATION_ID?.trim()) return null;
  return { interactionId: id as string, guildId: guild_id as string, channelId: channel_id as string,
    applicationId: application_id as string, userId: userId as string, token };
}

export function canCompleteItemSelling(context: ItemSellingContext, settings: BotRuntimeSettings) {
  return context.userId === GODAWP_DISCORD_USER_ID || settings.ticketCloseAdminDiscordUserIds.includes(context.userId);
}

export function itemSellingResponse(raw: unknown, settings?: BotRuntimeSettings) {
  const interaction = parseItemSellingInteraction(raw);
  const context = itemSellingContext(raw);
  if (!IS_GWSTORE || !interaction || !context) return sellingEphemeral("Este atendimento está disponível apenas na GWStore.");
  if (interaction.kind === "open") {
    return { type: 9, data: { custom_id: SELLING_SUBMIT_ID, title: "Vender um item para a GWStore", components: [{
      type: 18, label: "Qual item você quer vender?", component: {
        type: 4, custom_id: "item_name", style: 1, required: true, min_length: 1, max_length: 120,
        placeholder: "Ex.: Dragon, gamepass ou skin",
      },
    }] } };
  }
  if (interaction.kind === "submit" && !interaction.itemName) return sellingEphemeral("Informe o nome do item, com até 120 caracteres.");
  if (interaction.kind === "complete" && (interaction.channelId !== context.channelId || !settings || !canCompleteItemSelling(context, settings))) {
    return sellingEphemeral("Apenas o GodAwp e a equipe autorizada podem concluir este ticket.");
  }
  return { type: 5, data: { flags: 64 } };
}

export function sellingEntryMessage() {
  return { embeds: [{ title: SELLING_ENTRY_TITLE, color: 0xcc37c8,
    description: "Tem um item e quer vender para o GodAwp?\n\n**1.** Clique em **Vender um item**.\n**2.** Informe o nome do item.\n**3.** Converse com o GodAwp no seu ticket privado.\n\nVocê pode enviar detalhes, imagens e combinar o valor dentro do ticket.",
    footer: { text: "GWStore • Atendimento privado para vendedores" },
  }], components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: SELLING_OPEN_ID,
    label: "Vender um item", emoji: { name: "📦" } }] }], allowed_mentions: { parse: [] } };
}

export function sellingTicketComponents(channelId: string, completed = false) {
  return [{ type: 1, components: [{ type: 2, style: completed ? 2 : 3,
    custom_id: `${SELLING_COMPLETE_PREFIX}${channelId}`, label: completed ? "Ticket concluído" : "Concluir ticket",
    emoji: { name: "✅" }, disabled: completed }] }];
}

export function sellingEphemeral(content: string) {
  return { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } };
}

export function escapeSellingText(text: string) {
  return text.replace(/([\\`*_~|<>\[\]()])/g, "\\$1");
}

function findInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) { const found = findInput(entry); if (found !== undefined) return found; }
  } else if (isObject(value)) {
    if (value.custom_id === "item_name") return value.value;
    return findInput(value.component ?? value.components);
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
