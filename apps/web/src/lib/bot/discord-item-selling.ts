import { IS_GWSTORE } from "@/lib/brand";
import type { BotRuntimeSettings } from "./message-customization-server";

export const GWSTORE_SELLING_GUILD_ID = "1401264061101899820";
export const GODAWP_DISCORD_USER_ID = "385924725332901909";
export const SELLING_ENTRY_TOPIC = "Quer vender um item para o GodAwp? Clique em Vender um item e informe o nome para abrir seu ticket privado.";
export function isSellingEntryTopic(topic: string | null | undefined) {
  return topic === SELLING_ENTRY_TOPIC || topic === "gwstore-item-selling:v1";
}
export const SELLING_ENTRY_TITLE = "📦 VENDA SEU ITEM PARA A GWSTORE";
export const SELLING_TICKET_TOPIC = "gwstore-item-offer:";
export const SELLING_OPEN_ID = "gwsell:open";
export const SELLING_SUBMIT_ID = "gwsell:submit";
export const SELLING_COMPLETE_PREFIX = "gwsell:complete:";
export const SELLING_CLOSE_PREFIX = "gwsell:close:";
export const SELLING_CLOSE_CONFIRM_PREFIX = "gwsell:close-confirm:";
export const SELLING_CLOSE_CANCEL_PREFIX = "gwsell:close-cancel:";
export const SNOWFLAKE = /^[0-9]{15,22}$/;

export type ItemSellingInteraction =
  | { kind: "open" }
  | { kind: "submit"; itemName: string | null }
  | { kind: "complete" | "close_request" | "close_confirm" | "close_cancel"; channelId: string };

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
  if (raw.type === 3 && typeof id === "string") {
    for (const [prefix, kind] of [
      [SELLING_COMPLETE_PREFIX, "complete"],
      [SELLING_CLOSE_PREFIX, "close_request"],
      [SELLING_CLOSE_CONFIRM_PREFIX, "close_confirm"],
      [SELLING_CLOSE_CANCEL_PREFIX, "close_cancel"],
    ] as const) {
      if (!id.startsWith(prefix)) continue;
      const channelId = id.slice(prefix.length);
      return SNOWFLAKE.test(channelId) ? { kind, channelId } : null;
    }
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
  if (interaction.kind !== "submit") {
    if (interaction.channelId !== context.channelId || !settings || !canCompleteItemSelling(context, settings)) {
      return sellingEphemeral("Apenas o GodAwp e a equipe autorizada podem concluir ou fechar este ticket.");
    }
    if (interaction.kind === "close_request") {
      return { type: 4, data: { content: "**Fechar este ticket de venda?**\nO canal e seu histórico serão apagados. Confirme apenas quando o atendimento estiver encerrado.",
        flags: 64, allowed_mentions: { parse: [] }, components: [{ type: 1, components: [
          { type: 2, style: 4, custom_id: `${SELLING_CLOSE_CONFIRM_PREFIX}${context.channelId}`, label: "Confirmar fechamento" },
          { type: 2, style: 2, custom_id: `${SELLING_CLOSE_CANCEL_PREFIX}${context.channelId}`, label: "Cancelar" },
        ] }] } };
    }
    if (interaction.kind === "close_cancel") {
      return { type: 7, data: { content: "Fechamento cancelado. O ticket continua aberto.",
        components: [], allowed_mentions: { parse: [] } } };
    }
  }
  return { type: 5, data: { flags: 64 } };
}

export function sellingEntryMessage() {
  return { embeds: [{ title: SELLING_ENTRY_TITLE, color: 0xcc37c8,
    description: "Confira os valores que o **GodAwp paga** pelos itens abaixo.\n\n**1.** Clique em **Vender um item**.\n**2.** Informe o nome do item.\n**3.** Converse com o GodAwp no seu ticket privado.",
    fields: [
      { name: "🍎 FRUTAS FÍSICAS", inline: false, value: sellingPriceTable([
        ["Dragon West", 55], ["Dragon East", 50], ["Magnetic", 20], ["Kitsune", 12],
        ["Control", 5], ["Yeti", 5], ["Tiger", 5],
      ]) },
      { name: "💎 SKINS", inline: false, value: sellingPriceTable([
        ["Rabid", 400], ["Banner Doghouse", 250], ["Banner Vibeframes", 150],
        ["Kitsune Galaxy", 140], ["Dragon Ember", 120], ["Kitsune Imperial", 120],
        ["Meme Fruit", 120], ["Rumble Roxa", 80], ["Magnetic Arcsteel", 55],
        ["Rumble Vermelha", 45], ["Pain Super Spirit", 38], ["Divine Portal", 35],
        ["Dog Blade", 35], ["Runic Fiend", 35], ["Werewolf", 25], ["Yeti Fiend", 22],
        ["Pain Celestial", 20], ["Rumble Amarela", 8], ["Rumble Verde", 8], ["Gravity Skin", 10],
      ]) },
    ],
    footer: { text: "GWStore • Atendimento privado para vendedores" },
  }], components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: SELLING_OPEN_ID,
    label: "Vender um item", emoji: { name: "📦" } }] }], allowed_mentions: { parse: [] } };
}

function sellingPriceTable(rows: Array<[string, number]>) {
  const itemWidth = Math.max(...rows.map(([item]) => item.length));
  const priceWidth = "Compro por".length;
  const header = `${"Item".padEnd(itemWidth)}  Compro por`;
  const divider = `${"─".repeat(itemWidth)}  ${"─".repeat(priceWidth)}`;
  const items = rows.map(([item, price]) => `${item.padEnd(itemWidth)}  ${`R$ ${price}`.padStart(priceWidth)}`);
  return `\`\`\`text\n${[header, divider, ...items].join("\n")}\n\`\`\``;
}

export function sellingTicketComponents(channelId: string, completed = false) {
  return [{ type: 1, components: [{ type: 2, style: completed ? 2 : 3,
    custom_id: `${SELLING_COMPLETE_PREFIX}${channelId}`, label: completed ? "Ticket concluído" : "Concluir ticket",
    emoji: { name: "✅" }, disabled: completed }, { type: 2, style: 4,
    custom_id: `${SELLING_CLOSE_PREFIX}${channelId}`, label: "Fechar ticket", emoji: { name: "🗑️" } }] }];
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
