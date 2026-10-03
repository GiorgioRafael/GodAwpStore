import "server-only";

import { IS_GWSTORE } from "@/lib/brand";
import { assertConfiguredDiscordBotIdentity, discordApiUrl, discordBotJson } from "./discord-api";
import { resolveGwStoreTicketCategoryId } from "./discord-ticket-categories";
import { buildTicketPermissionOverwrites, samePermissionOverwrites, type DiscordPermissionOverwrite } from "./discord-ticket-controls";
import { loadBotRuntimeSettings, type BotRuntimeSettings } from "./message-customization-server";
import { GODAWP_DISCORD_USER_ID, GWSTORE_SELLING_GUILD_ID, SELLING_ENTRY_TOPIC, SELLING_ENTRY_TITLE,
  SELLING_TICKET_TOPIC, SNOWFLAKE, canCompleteItemSelling, escapeSellingText, itemSellingContext,
  isSellingEntryTopic, parseItemSellingInteraction, sellingEntryMessage, sellingTicketComponents, type ItemSellingContext } from "./discord-item-selling";

type Channel = { id: string; guild_id?: string; name: string; type: number; topic?: string | null;
  parent_id?: string | null; permission_overwrites?: DiscordPermissionOverwrite[] };
type Message = { id: string; author?: { id: string }; embeds?: Array<{ title?: string; footer?: { text?: string } }> };
type Offer = { requestId: string; sellerId: string; itemName: string; status: "open" | "completed"; welcomeId?: string; completedBy?: string };
const WRITE_PERMISSIONS = (1n << 11n) | (1n << 35n) | (1n << 36n) | (1n << 38n) | (1n << 31n) | (1n << 50n);
const VIEW_CHANNEL = 1n << 10n;
const ATTACH_FILES = 1n << 15n;
const tasks = new Map<string, Promise<string>>();

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
  return { status: "published", channelId: channel.id, messageId: published.id };
}

export async function completeItemSellingInteraction(raw: unknown, options: {
  fetcher?: typeof fetch; settings?: BotRuntimeSettings;
} = {}) {
  const context = itemSellingContext(raw);
  const interaction = parseItemSellingInteraction(raw);
  if (!IS_GWSTORE || !context || !interaction || interaction.kind === "open") return;
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
    } else {
      if (interaction.channelId !== context.channelId || !canCompleteItemSelling(context, settings)) {
        await updateInteraction(context, "Apenas o GodAwp e a equipe autorizada podem concluir este ticket.", fetcher);
        return;
      }
      await completeOffer(context, botId, fetcher);
      await updateInteraction(context, "Ticket concluído. O histórico foi preservado e novas mensagens foram bloqueadas.", fetcher);
    }
  } catch (error) {
    console.error("[discord:item-selling]", error instanceof Error ? error.message : "Falha no atendimento.");
    await updateInteraction(context, "Não foi possível concluir agora. Tente novamente; um ticket já aberto será recuperado.", fetcher).catch(() => undefined);
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
          description: `**Item oferecido:** ${escapeSellingText(offer.itemName)}\n\nEnvie aqui os detalhes, imagens e o valor que deseja receber. O GodAwp vai conversar com você neste ticket.\n\nA equipe pode finalizar o atendimento em **Concluir ticket**.`,
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

async function completeOffer(context: ItemSellingContext, botId: string, fetcher: typeof fetch) {
  const channel = await discordBotJson<Channel>(`/channels/${context.channelId}`, {}, fetcher);
  assertChannel(channel);
  const offer = readOffer(channel.topic);
  if (!offer) throw new Error("Este canal não é um ticket de venda de item.");
  const marker = `GWStore • Oferta ${offer.requestId}`;
  const welcome = await findMessages(channel.id, message => message.author?.id === botId && message.embeds?.[0]?.footer?.text === marker, fetcher);
  if (welcome.length !== 1) throw new Error("Não foi possível identificar a mensagem inicial do ticket.");
  // One PATCH marks the state, renames and locks the seller's conversation.
  const permissions = (channel.permission_overwrites ?? []).map(overwrite => overwrite.type === 1 && overwrite.id === offer.sellerId && overwrite.id !== botId
    ? { ...overwrite, allow: (BigInt(overwrite.allow) & ~WRITE_PERMISSIONS).toString(), deny: (BigInt(overwrite.deny) | WRITE_PERMISSIONS).toString() } : overwrite);
  const completed: Offer = { ...offer, status: "completed", completedBy: offer.completedBy ?? context.userId };
  const name = `✅・concluido-${channel.name.replace(/^✅[・┊\s-]*concluido-/u, "")}`.slice(0, 100);
  await discordBotJson(`/channels/${channel.id}`, { method: "PATCH", signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ name, topic: offerTopic(completed), permission_overwrites: permissions }) }, fetcher);
  await discordBotJson(`/channels/${channel.id}/messages/${welcome[0].id}`, {
    method: "PATCH", body: JSON.stringify({ components: sellingTicketComponents(channel.id, true) }),
  }, fetcher);
  const completeMarker = `GWStore • Oferta concluída ${offer.requestId}`;
  const notices = await findMessages(channel.id, message => message.author?.id === botId && message.embeds?.[0]?.footer?.text === completeMarker, fetcher);
  if (!notices.length) await discordBotJson(`/channels/${channel.id}/messages`, {
    method: "POST", signal: AbortSignal.timeout(15_000), body: JSON.stringify({
      embeds: [{ title: "✅ Ticket concluído", color: 0x32ad72,
        description: `Atendimento finalizado por <@${completed.completedBy}>.\nO histórico deste ticket foi preservado.`,
        footer: { text: completeMarker } }], allowed_mentions: { parse: [] },
      nonce: `done:${channel.id}`, enforce_nonce: true,
    }),
  }, fetcher);
}

function offerTopic(offer: Offer) { return `${SELLING_TICKET_TOPIC}${JSON.stringify(offer)}`; }
function readOffer(topic: string | null | undefined): Offer | null {
  if (!topic?.startsWith(SELLING_TICKET_TOPIC)) return null;
  try {
    const value = JSON.parse(topic.slice(SELLING_TICKET_TOPIC.length));
    if (!SNOWFLAKE.test(value.requestId) || !SNOWFLAKE.test(value.sellerId) || typeof value.itemName !== "string" || value.itemName.length < 1 || value.itemName.length > 120 || !["open", "completed"].includes(value.status)) return null;
    return value as Offer;
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
async function findMessages(channelId: string, predicate: (message: Message) => boolean, fetcher: typeof fetch) {
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
  throw new Error("Histórico grande demais para identificar o atendimento com segurança.");
}
async function updateInteraction(context: ItemSellingContext, content: string, fetcher: typeof fetch) {
  const response = await fetcher(`${discordApiUrl()}/webhooks/${context.applicationId}/${context.token}/messages/@original`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ content, allowed_mentions: { parse: [] }, components: [] }),
  });
  if (!response.ok) throw new Error(`Discord não confirmou a resposta privada (${response.status}).`);
}
