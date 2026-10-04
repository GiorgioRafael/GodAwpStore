import "server-only";

import { IS_GWSTORE } from "@/lib/brand";
import { assertConfiguredDiscordBotIdentity, DiscordApiError, discordApiUrl, discordBotJson, discordBotRequest, isDiscordUnknownChannelResponse } from "./discord-api";
import { resolveGwStoreTicketCategoryId } from "./discord-ticket-categories";
import { buildTicketPermissionOverwrites, samePermissionOverwrites, type DiscordPermissionOverwrite } from "./discord-ticket-controls";
import { loadBotRuntimeSettings, type BotRuntimeSettings } from "./message-customization-server";
import { GODAWP_DISCORD_USER_ID, GWSTORE_SELLING_GUILD_ID, SELLING_ENTRY_TOPIC, SELLING_ENTRY_TITLE,
  SELLING_TICKET_TOPIC, SNOWFLAKE, canCompleteItemSelling, escapeSellingText, itemSellingContext,
  isSellingEntryTopic, parseItemSellingInteraction, sellingEntryMessage, sellingTicketComponents, type ItemSellingContext } from "./discord-item-selling";

type Channel = { id: string; guild_id?: string; name: string; type: number; topic?: string | null;
  parent_id?: string | null; permission_overwrites?: DiscordPermissionOverwrite[] };
type Message = { id: string; timestamp?: string; components?: unknown; author?: { id: string }; embeds?: Array<{ title?: string; footer?: { text?: string } }> };
type Offer = { requestId: string; sellerId: string; itemName: string; status: "open" | "completed"; welcomeId?: string; completedBy?: string; completedAt?: string };
const WRITE_PERMISSIONS = (1n << 11n) | (1n << 35n) | (1n << 36n) | (1n << 38n) | (1n << 31n) | (1n << 50n);
const VIEW_CHANNEL = 1n << 10n;
const ATTACH_FILES = 1n << 15n;
const tasks = new Map<string, Promise<string>>();
const AUTO_CLOSE_DELAY_MS = 5 * 60_000;
const MAX_TICKETS_PER_RUN = 100;
const COMPLETION_DESCRIPTION = "Este ticket será fechado automaticamente após **5 minutos**. A checagem acontece a cada **3 minutos**, então o fechamento normalmente ocorre entre **5 e 8 minutos**. A equipe também pode usar **Fechar ticket**.";

export type ItemSellingAutoCloseSummary = { scanned: number; completed: number; alreadyClosed: number; active: number; failed: number };

/** Run only on production GWStore deployments. No purchase or payment is created. */
export async function synchronizeGwStoreItemSelling(options: { fetcher?: typeof fetch } = {}) {
  if (!IS_GWSTORE) return { status: "disabled" };
  const fetcher = options.fetcher ?? fetch;
  const botId = await assertConfiguredDiscordBotIdentity(fetcher);
  const channels = await listChannels(fetcher);
  const matches = channels.filter(channel => channel.type === 0 && isSellingEntryTopic(channel.topic));
  if (matches.length > 1) throw new Error("Há mais de um canal para vender itens à GWStore.");
  const category = channels.find(channel => channel.type === 4 && canonicalName(channel.name) === "comprar");
  const permissions: DiscordPermissionOverwrite[] = [
    { id: GWSTORE_SELLING_GUILD_ID, type: 0, allow: "0", deny: WRITE_PERMISSIONS.toString() },
    { id: botId, type: 1, allow: ((1n << 11n) | VIEW_CHANNEL | (1n << 14n) | (1n << 16n)).toString(), deny: "0" },
  ];
  let channel = matches[0];
  if (!channel) {
    channel = await discordBotJson<Channel>(`/guilds/${GWSTORE_SELLING_GUILD_ID}/channels`, {
      method: "POST", signal: AbortSignal.timeout(15_000), body: JSON.stringify({
        name: "📦┊vender-itens", type: 0, topic: SELLING_ENTRY_TOPIC,
        permission_overwrites: permissions, ...(category ? { parent_id: category.id } : {}),
      }),
    }, fetcher);
  } else if (channel.topic !== SELLING_ENTRY_TOPIC || !samePermissionOverwrites(channel.permission_overwrites ?? [], permissions)) {
    channel = await discordBotJson<Channel>(`/channels/${channel.id}`, {
      method: "PATCH", body: JSON.stringify({ topic: SELLING_ENTRY_TOPIC, permission_overwrites: permissions }),
    }, fetcher);
  }
  assertChannel(channel);
  const messages = await findMessages(channel.id, message => message.author?.id === botId && message.embeds?.[0]?.title === SELLING_ENTRY_TITLE, fetcher);
  if (messages.length > 1) throw new Error("Há mais de uma mensagem de venda de itens no canal.");
  const message = messages[0];
  const payload = sellingEntryMessage();
  const published = await discordBotJson<Message>(`/channels/${channel.id}/messages${message ? `/${message.id}` : ""}`, {
    method: message ? "PATCH" : "POST", signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ ...payload, ...(!message ? { nonce: `sell:${channel.id}`, enforce_nonce: true } : {}) }),
  }, fetcher);
  if (!SNOWFLAKE.test(published.id)) throw new Error("Discord não confirmou a mensagem de venda de itens.");
  const ticketUpdates = { ticketsScanned: 0, ticketsUpdated: 0, ticketsFailed: 0, legacyCompletionTimesMigrated: 0 };
  for (const candidate of channels.filter(row => row.type === 0 && readOffer(row.topic)).slice(0, MAX_TICKETS_PER_RUN)) {
    ticketUpdates.ticketsScanned++;
    try {
      const ticket = await verifiedOfferChannel(candidate.id, botId, fetcher);
      let offer = ticket.offer;
      if (offer.status === "completed" && !offer.completedAt) {
        offer = await ensureCompletionTime(ticket.channel.id, offer, botId, Date.now(), fetcher);
        ticketUpdates.legacyCompletionTimesMigrated++;
      }
      await ensureSellingTicketComponents(ticket.channel.id, ticket.welcome, offer.status === "completed", fetcher);
      if (offer.status === "completed") await synchronizeCompletionNotice(ticket.channel.id, offer, botId, fetcher, false);
      ticketUpdates.ticketsUpdated++;
    } catch (error) {
      ticketUpdates.ticketsFailed++;
      console.error("[discord:item-selling-sync]", error instanceof Error ? error.message : "Falha ao atualizar ticket.");
    }
  }
  return { status: "published", channelId: channel.id, messageId: published.id, ...ticketUpdates };
}

export async function completeItemSellingInteraction(raw: unknown, options: {
  fetcher?: typeof fetch; settings?: BotRuntimeSettings; now?: () => number;
} = {}) {
  const context = itemSellingContext(raw);
  const interaction = parseItemSellingInteraction(raw);
  if (!IS_GWSTORE || !context || !interaction || !["submit", "complete", "close_confirm"].includes(interaction.kind)) return;
  const fetcher = options.fetcher ?? fetch;
  try {
    const settings = options.settings ?? await loadBotRuntimeSettings();
    const botId = await assertConfiguredDiscordBotIdentity(fetcher);
    if (interaction.kind === "submit") {
      if (!interaction.itemName) throw new Error("Nome do item inválido.");
      const key = `${context.guildId}:${context.userId}`;
      let task = tasks.get(key);
      if (!task) {
        task = openOffer(context, interaction.itemName, botId, settings, fetcher).finally(() => {
          if (tasks.get(key) === task) tasks.delete(key);
        });
        tasks.set(key, task);
      }
      const channelId = await task;
      await updateInteraction(context, `Seu ticket de venda está aberto em <#${channelId}>. Converse com o GodAwp por lá.`, fetcher);
    } else if (interaction.kind === "complete" || interaction.kind === "close_confirm") {
      if (interaction.channelId !== context.channelId || !canCompleteItemSelling(context, settings)) {
        await updateInteraction(context, "Apenas o GodAwp e a equipe autorizada podem concluir ou fechar este ticket.", fetcher);
        return;
      }
      if (interaction.kind === "close_confirm") {
        const closed = await closeVerifiedOffer(context.channelId, botId, fetcher);
        await updateInteraction(context, closed ? "Ticket de venda fechado." : "Este ticket já foi fechado.", fetcher);
      } else {
        await completeOffer(context, botId, (options.now ?? Date.now)(), fetcher);
        await updateInteraction(context, `Ticket concluído e novas mensagens bloqueadas. ${COMPLETION_DESCRIPTION}`, fetcher);
      }
    }
  } catch (error) {
    console.error("[discord:item-selling]", error instanceof Error ? error.message : "Falha no atendimento.");
    const failure = interaction.kind === "close_confirm" ? "Não foi possível fechar este ticket agora. Tente novamente." : "Não foi possível concluir agora. Tente novamente; um ticket já aberto será recuperado.";
    await updateInteraction(context, failure, fetcher).catch(() => undefined);
  }
}

async function openOffer(context: ItemSellingContext, itemName: string, botId: string, settings: BotRuntimeSettings, fetcher: typeof fetch) {
  const entry = await discordBotJson<Channel>(`/channels/${context.channelId}`, {}, fetcher);
  assertChannel(entry);
  if (!isSellingEntryTopic(entry.topic)) throw new Error("Este formulário não veio do canal de venda de itens.");
  const channels = await listChannels(fetcher);
  // Reuse the seller's open conversation instead of creating spam tickets.
  let channel = channels.find(candidate => {
    const offer = readOffer(candidate.topic);
    return candidate.type === 0 && offer?.sellerId === context.userId && offer.status === "open";
  });
  const parentId = await resolveGwStoreTicketCategoryId(context.guildId, "sale", channels, fetcher);
  let offer = channel ? readOffer(channel.topic)! : { requestId: context.interactionId, sellerId: context.userId, itemName, status: "open" as const };
  if (!channel) {
    const permissions = buildTicketPermissionOverwrites({ guildId: context.guildId, buyerDiscordId: context.userId,
      botDiscordId: botId, closerDiscordUserIds: settings.ticketCloseAdminDiscordUserIds,
      notificationDiscordUserIds: [GODAWP_DISCORD_USER_ID] }).map(overwrite => overwrite.type === 1
        ? { ...overwrite, allow: (BigInt(overwrite.allow) | ATTACH_FILES).toString() } : overwrite);
    channel = await discordBotJson<Channel>(`/guilds/${context.guildId}/channels`, {
      method: "POST", signal: AbortSignal.timeout(15_000), body: JSON.stringify({
        name: `venda-${canonicalName(itemName).slice(0, 45) || "item"}-${context.userId.slice(-6)}`,
        type: 0, topic: offerTopic(offer), permission_overwrites: permissions,
        ...(parentId ? { parent_id: parentId } : {}),
      }),
    }, fetcher);
  } else if (parentId && channel.parent_id !== parentId) {
    channel = await discordBotJson<Channel>(`/channels/${channel.id}`, {
      method: "PATCH", signal: AbortSignal.timeout(15_000), body: JSON.stringify({ parent_id: parentId }),
    }, fetcher);
  }
  assertChannel(channel);
  const marker = `GWStore • Oferta ${offer.requestId}`;
  const welcome = await findMessages(channel.id, message => message.author?.id === botId && message.embeds?.[0]?.footer?.text === marker, fetcher);
  if (welcome.length > 1) throw new Error("Mensagem de atendimento duplicada.");
  let welcomeId = welcome[0]?.id;
  if (!welcomeId) {
    const sent = await discordBotJson<Message>(`/channels/${channel.id}/messages`, {
      method: "POST", signal: AbortSignal.timeout(15_000), body: JSON.stringify({
        content: `<@${GODAWP_DISCORD_USER_ID}> <@${offer.sellerId}>`,
        embeds: [{ title: "📦 Venda de item para a GWStore", color: 0xcc37c8,
          description: `**Item oferecido:** ${escapeSellingText(offer.itemName)}\n\nEnvie aqui os detalhes, imagens e o valor que deseja receber. O GodAwp vai conversar com você neste ticket.\n\nA equipe pode finalizar o atendimento em **Concluir ticket** ou usar **Fechar ticket**.`,
          footer: { text: marker } }], components: sellingTicketComponents(channel.id),
        allowed_mentions: { parse: [], users: [...new Set([GODAWP_DISCORD_USER_ID, offer.sellerId])], replied_user: false },
        nonce: `o:${offer.requestId}`, enforce_nonce: true,
      }),
    }, fetcher);
    if (!SNOWFLAKE.test(sent.id)) throw new Error("Mensagem inicial do ticket inválida.");
    welcomeId = sent.id;
  }
  if (offer.welcomeId !== welcomeId) {
    offer = { ...offer, welcomeId };
    await discordBotJson(`/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ topic: offerTopic(offer) }) }, fetcher);
  }
  return channel.id;
}

async function completeOffer(context: ItemSellingContext, botId: string, now: number, fetcher: typeof fetch) {
  const { channel, offer, welcome } = await verifiedOfferChannel(context.channelId, botId, fetcher);
  // Keep the first durable completion time, including retries after a partial Discord failure.
  const completed: Offer = offer.status === "completed"
    ? await completionWithTime(channel.id, offer, botId, now, fetcher)
    : { ...offer, status: "completed", completedBy: context.userId, completedAt: validNowIso(now) };
  const permissions = (channel.permission_overwrites ?? []).map(overwrite => overwrite.type === 1 && overwrite.id === offer.sellerId && overwrite.id !== botId
    ? { ...overwrite, allow: (BigInt(overwrite.allow) & ~WRITE_PERMISSIONS).toString(), deny: (BigInt(overwrite.deny) | WRITE_PERMISSIONS).toString() } : overwrite);
  const name = `✅・concluido-${channel.name.replace(/^✅[・┊\s-]*concluido-/u, "")}`.slice(0, 100);
  await discordBotJson(`/channels/${channel.id}`, { method: "PATCH", signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ name, topic: offerTopic(completed), permission_overwrites: permissions }) }, fetcher);
  await discordBotJson(`/channels/${channel.id}/messages/${welcome.id}`, {
    method: "PATCH", body: JSON.stringify({ components: sellingTicketComponents(channel.id, true), allowed_mentions: { parse: [] } }),
  }, fetcher);
  await synchronizeCompletionNotice(channel.id, completed, botId, fetcher);
}

/** A durable topic deadline lets subsequent cron invocations recover failed deletions. */
export async function reconcileCompletedGwStoreItemSellingTickets(options: {
  fetcher?: typeof fetch; now?: () => number; limit?: number;
} = {}): Promise<ItemSellingAutoCloseSummary> {
  const summary: ItemSellingAutoCloseSummary = { scanned: 0, completed: 0, alreadyClosed: 0, active: 0, failed: 0 };
  if (!IS_GWSTORE) return summary;
  const fetcher = options.fetcher ?? fetch;
  const now = (options.now ?? Date.now)();
  validNowIso(now);
  const botId = await assertConfiguredDiscordBotIdentity(fetcher);
  const limit = Number.isFinite(options.limit) ? Math.max(0, Math.min(MAX_TICKETS_PER_RUN, Math.floor(options.limit!))) : MAX_TICKETS_PER_RUN;
  const channels = await listChannels(fetcher);
  const candidates = channels.filter(channel => channel.type === 0 && channel.guild_id === GWSTORE_SELLING_GUILD_ID && readOffer(channel.topic))
    .sort((a, b) => {
      const first = readOffer(a.topic)!;
      const second = readOffer(b.topic)!;
      if (first.status !== second.status) return first.status === "completed" ? -1 : 1;
      return (first.completedAt ?? "").localeCompare(second.completedAt ?? "");
    })
    .slice(0, limit);
  for (const candidate of candidates) {
    summary.scanned++;
    try {
      const verified = await verifiedOfferChannel(candidate.id, botId, fetcher);
      // Recover button updates as well as closures after a deployment or rate limit.
      if (verified.offer.status !== "completed") {
        await ensureSellingTicketComponents(candidate.id, verified.welcome, false, fetcher);
        summary.active++; continue;
      }
      const offer = await ensureCompletionTime(candidate.id, verified.offer, botId, now, fetcher);
      if (now - Date.parse(offer.completedAt!) < AUTO_CLOSE_DELAY_MS) {
        await ensureSellingTicketComponents(candidate.id, verified.welcome, true, fetcher);
        summary.active++; continue;
      }
      // Recheck the persisted state and our welcome before the destructive request.
      const current = await verifiedOfferChannel(candidate.id, botId, fetcher);
      if (current.offer.status !== "completed" || current.offer.requestId !== offer.requestId || current.offer.sellerId !== offer.sellerId || current.offer.completedAt !== offer.completedAt) {
        summary.active++; continue;
      }
      const deleted = await deleteOfferChannel(candidate.id, fetcher);
      if (deleted) summary.completed++; else summary.alreadyClosed++;
    } catch (error) {
      if (isUnknownChannelError(error)) summary.alreadyClosed++;
      else {
        summary.failed++;
        console.error("[discord:item-selling-auto-close]", error instanceof Error ? error.message : "Falha ao fechar ticket.");
      }
    }
  }
  return summary;
}

async function ensureSellingTicketComponents(channelId: string, welcome: Message, completed: boolean, fetcher: typeof fetch) {
  const components = sellingTicketComponents(channelId, completed);
  if (sellingComponentsSignature(welcome.components) === sellingComponentsSignature(components)) return false;
  await discordBotJson(`/channels/${channelId}/messages/${welcome.id}`, {
    method: "PATCH", body: JSON.stringify({ components, allowed_mentions: { parse: [] } }),
  }, fetcher);
  return true;
}

// Discord adds component IDs and may send disabled=false even when it was omitted.
// Compare only the fields that define our two buttons, so retries make no redundant writes.
function sellingComponentsSignature(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const rows = [];
  for (const rawRow of value) {
    if (typeof rawRow !== "object" || rawRow === null || rawRow.type !== 1 || !Array.isArray(rawRow.components)) return null;
    const buttons = [];
    for (const rawButton of rawRow.components) {
      if (typeof rawButton !== "object" || rawButton === null || rawButton.type !== 2 || typeof rawButton.style !== "number"
        || typeof rawButton.custom_id !== "string" || typeof rawButton.label !== "string"
        || (rawButton.disabled !== undefined && typeof rawButton.disabled !== "boolean")) return null;
      const emoji = rawButton.emoji;
      if (emoji !== undefined && (typeof emoji !== "object" || emoji === null || typeof emoji.name !== "string")) return null;
      buttons.push({ type: rawButton.type, custom_id: rawButton.custom_id, style: rawButton.style, label: rawButton.label,
        emojiName: emoji?.name ?? null, disabled: rawButton.disabled === true });
    }
    rows.push({ type: rawRow.type, buttons });
  }
  return JSON.stringify(rows);
}

async function closeVerifiedOffer(channelId: string, botId: string, fetcher: typeof fetch) {
  try { await verifiedOfferChannel(channelId, botId, fetcher); }
  catch (error) { if (isUnknownChannelError(error)) return false; throw error; }
  return deleteOfferChannel(channelId, fetcher);
}

async function deleteOfferChannel(channelId: string, fetcher: typeof fetch) {
  const path = `/channels/${channelId}`;
  const response = await discordBotRequest(path, { method: "DELETE", signal: AbortSignal.timeout(15_000) }, fetcher);
  if (await isDiscordUnknownChannelResponse(response)) return false;
  if (!response.ok) {
    const payload: unknown = await response.clone().json().catch(() => null);
    const code = typeof payload === "object" && payload !== null && "code" in payload && typeof payload.code === "number" ? payload.code : null;
    throw new DiscordApiError(response.status, path, "DELETE", code);
  }
  const deleted: unknown = await response.json();
  if (typeof deleted !== "object" || deleted === null || !("id" in deleted) || deleted.id !== channelId || !("guild_id" in deleted) || deleted.guild_id !== GWSTORE_SELLING_GUILD_ID) {
    throw new Error("Discord não confirmou o canal de venda fechado.");
  }
  return true;
}

async function verifiedOfferChannel(channelId: string, botId: string, fetcher: typeof fetch) {
  const channel = await discordBotJson<Channel>(`/channels/${channelId}`, {}, fetcher);
  assertChannel(channel);
  if (channel.id !== channelId) throw new Error("Discord respondeu com outro canal de atendimento.");
  const offer = readOffer(channel.topic);
  if (!offer) throw new Error("Este canal não é um ticket de venda de item do nosso bot.");
  const marker = `GWStore • Oferta ${offer.requestId}`;
  const welcomes = offer.welcomeId
    ? [await discordBotJson<Message>(`/channels/${channel.id}/messages/${offer.welcomeId}`, {}, fetcher)]
    : await findMessages(channel.id, message => message.author?.id === botId && message.embeds?.[0]?.footer?.text === marker, fetcher);
  const welcome = welcomes[0];
  if (welcomes.length !== 1 || !welcome || !SNOWFLAKE.test(welcome.id) || welcome.author?.id !== botId || welcome.embeds?.[0]?.footer?.text !== marker || (offer.welcomeId && welcome.id !== offer.welcomeId)) {
    throw new Error("Não foi possível identificar a mensagem inicial do nosso bot neste ticket.");
  }
  return { channel, offer, welcome };
}

async function completionWithTime(channelId: string, offer: Offer, botId: string, now: number, fetcher: typeof fetch): Promise<Offer> {
  if (offer.completedAt) return offer;
  const notices = await completionNotices(channelId, offer, botId, fetcher);
  if (notices.length > 1) throw new Error("Aviso de conclusão duplicado.");
  const timestamp = notices[0] ? messageTime(notices[0]) : null;
  return { ...offer, completedAt: timestamp !== null && timestamp <= now ? new Date(timestamp).toISOString() : validNowIso(now) };
}

async function ensureCompletionTime(channelId: string, offer: Offer, botId: string, now: number, fetcher: typeof fetch) {
  if (offer.completedAt) return offer;
  const updated = await completionWithTime(channelId, offer, botId, now, fetcher);
  await discordBotJson(`/channels/${channelId}`, { method: "PATCH", body: JSON.stringify({ topic: offerTopic(updated) }) }, fetcher);
  return updated;
}

async function completionNotices(channelId: string, offer: Offer, botId: string, fetcher: typeof fetch) {
  return findMessages(channelId, message => message.author?.id === botId && message.embeds?.[0]?.footer?.text === `GWStore • Oferta concluída ${offer.requestId}`, fetcher, true);
}

async function synchronizeCompletionNotice(channelId: string, offer: Offer, botId: string, fetcher: typeof fetch, createMissing = true) {
  const notices = await completionNotices(channelId, offer, botId, fetcher);
  if (notices.length > 1) throw new Error("Aviso de conclusão duplicado.");
  const notice = notices[0];
  if (!notice && !createMissing) return;
  await discordBotJson(`/channels/${channelId}/messages${notice ? `/${notice.id}` : ""}`, {
    method: notice ? "PATCH" : "POST", signal: AbortSignal.timeout(15_000), body: JSON.stringify({
      embeds: [{ title: "✅ Ticket concluído", color: 0x32ad72,
        description: `Atendimento finalizado por <@${offer.completedBy}>.\n\n${COMPLETION_DESCRIPTION}`,
        footer: { text: `GWStore • Oferta concluída ${offer.requestId}` } }], allowed_mentions: { parse: [] },
      ...(!notice ? { nonce: `done:${channelId}`, enforce_nonce: true } : {}),
    }),
  }, fetcher);
}

function isUnknownChannelError(error: unknown) {
  return error instanceof DiscordApiError && error.status === 404 && error.discordCode === 10003;
}
function validNowIso(now: number) {
  if (!Number.isFinite(now) || now <= 0 || !Number.isFinite(new Date(now).getTime())) throw new Error("Horário do atendimento inválido.");
  return new Date(now).toISOString();
}
function isoTimestamp(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 && new Date(parsed).toISOString() === value ? parsed : null;
}
function messageTime(message: Message) {
  const timestamp = typeof message.timestamp === "string" ? Date.parse(message.timestamp) : NaN;
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  if (!SNOWFLAKE.test(message.id)) return null;
  const fromSnowflake = Number((BigInt(message.id) >> 22n) + 1420070400000n);
  return Number.isFinite(new Date(fromSnowflake).getTime()) ? fromSnowflake : null;
}
function offerTopic(offer: Offer) { return `${SELLING_TICKET_TOPIC}${JSON.stringify(offer)}`; }
function readOffer(topic: string | null | undefined): Offer | null {
  if (typeof topic !== "string" || !topic.startsWith(SELLING_TICKET_TOPIC)) return null;
  try {
    const value: unknown = JSON.parse(topic.slice(SELLING_TICKET_TOPIC.length));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.requestId !== "string" || !SNOWFLAKE.test(row.requestId) || typeof row.sellerId !== "string" || !SNOWFLAKE.test(row.sellerId)
      || typeof row.itemName !== "string" || row.itemName.trim().length < 1 || row.itemName.length > 120 || /[\u0000-\u001f\u007f]/.test(row.itemName)
      || (row.status !== "open" && row.status !== "completed")
      || (row.welcomeId !== undefined && (typeof row.welcomeId !== "string" || !SNOWFLAKE.test(row.welcomeId)))
      || (row.completedBy !== undefined && (typeof row.completedBy !== "string" || !SNOWFLAKE.test(row.completedBy)))
      || (row.status === "completed" && typeof row.completedBy !== "string")
      || (row.completedAt !== undefined && isoTimestamp(row.completedAt) === null)) return null;
    return row as Offer;
  } catch { return null; }
}
function canonicalName(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
async function listChannels(fetcher: typeof fetch) {
  return discordBotJson<Channel[]>(`/guilds/${GWSTORE_SELLING_GUILD_ID}/channels`, {}, fetcher);
}
function assertChannel(channel: Channel) {
  if (!SNOWFLAKE.test(channel.id) || channel.type !== 0 || channel.guild_id !== GWSTORE_SELLING_GUILD_ID) throw new Error("Canal de atendimento inválido para a GWStore.");
}
async function findMessages(channelId: string, predicate: (message: Message) => boolean, fetcher: typeof fetch, allowPartial = false) {
  let before = "";
  const found: Message[] = [];
  for (let page = 0; page < 10; page++) {
    const messages = await discordBotJson<Message[]>(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`, {}, fetcher);
    found.push(...messages.filter(predicate));
    if (messages.length < 100) return found;
    const oldestId = messages.at(-1)?.id;
    if (!oldestId || !SNOWFLAKE.test(oldestId)) throw new Error("Histórico do atendimento inválido.");
    before = oldestId;
  }
  if (allowPartial) return found;
  throw new Error("Histórico grande demais para identificar o atendimento com segurança.");
}
async function updateInteraction(context: ItemSellingContext, content: string, fetcher: typeof fetch) {
  const response = await fetcher(`${discordApiUrl()}/webhooks/${context.applicationId}/${context.token}/messages/@original`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ content, allowed_mentions: { parse: [] }, components: [] }),
  });
  if (!response.ok) throw new Error(`Discord não confirmou a resposta privada (${response.status}).`);
}
