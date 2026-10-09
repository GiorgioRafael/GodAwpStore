import "server-only";

import { IS_GWSTORE } from "@/lib/brand";
import {
  DiscordApiError,
  assertConfiguredDiscordBotIdentity,
  discordBotJson,
  discordBotRequest,
} from "./discord-api";
import {
  samePermissionOverwrites,
  type DiscordPermissionOverwrite,
} from "./discord-ticket-controls";
import { loadGwStoreOrderTicketKinds } from "./gw-up-ticket-routing";

const GUILD_ID = "1401264061101899820";
const SNOWFLAKE = /^[0-9]{15,22}$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PURCHASE_TOPIC = new RegExp(
  `^(?:gwstore-order:${UUID}(?:;welcome=1)?|gwstore:late-payment:${UUID}|gwstore:roulette-redemption:${UUID}|gwstore:giveaway:${UUID}(?::winner:${UUID})?(?:;welcome=1)?)$`,
  "i",
);
const SALE_TOPIC_PREFIX = "gwstore-item-offer:";
const ORDER_TOPIC = new RegExp(`^(?:gwstore-order:(${UUID})(?:;welcome=1)?|gwstore:late-payment:(${UUID}))$`, "i");
const VIEW_CHANNEL = 1n << 10n;
const MANAGE_CHANNELS = 1n << 4n;
const CATEGORY_NAMES = { purchase: "🛒┊COMPRA", up: "🆙┊UPPER", sale: "📦┊VENDA" } as const;
const CATEGORY_ORDER = ["purchase", "up", "sale"] as const;

export type TicketCategoryKind = keyof typeof CATEGORY_NAMES;
export type TicketCategoryChannel = {
  id: string;
  type: number;
  name?: string;
  topic?: string | null;
  guild_id?: string;
  parent_id?: string | null;
  position?: number;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

type EnsuredCategories = {
  channels: TicketCategoryChannel[];
  purchase: TicketCategoryChannel;
  up: TicketCategoryChannel;
  sale: TicketCategoryChannel;
  botId: string;
  createdCategoryIds: string[];
};
const categoryTasks = new WeakMap<typeof fetch, Promise<EnsuredCategories>>();

/** Keeps other stores and servers on their existing ticket routing. */
export async function resolveGwStoreTicketCategoryId(
  guildId: string,
  kind: TicketCategoryKind,
  channels: readonly TicketCategoryChannel[],
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (!IS_GWSTORE || guildId !== GUILD_ID) return null;
  const existing = findCategory(channels, kind);
  if (existing) return existing.id;
  const categories = await ensureCategories(fetcher);
  return categories[kind].id;
}

/** Migrates only known ticket channels, retaining their private access and history. */
export async function synchronizeGwStoreTicketCategories(options: {
  fetcher?: typeof fetch;
} = {}) {
  if (!IS_GWSTORE) return { status: "disabled" as const };
  const fetcher = options.fetcher ?? fetch;
  const categories = await ensureCategories(fetcher);
  const orderIds = [...new Set(categories.channels
    .filter(channel => isGuildChannel(channel) && channel.type === 0)
    .map(channel => ticketOrderId(channel.topic))
    .filter((id): id is string => id !== null))];
  // Resolve every order before moving tickets; a failed lookup must not guess their destination.
  const orderKinds = orderIds.length ? await loadGwStoreOrderTicketKinds(GUILD_ID, orderIds) : new Map();
  const others = categories.channels
    .filter(channel => isGuildChannel(channel) && channel.type === 4
      && !CATEGORY_ORDER.some(kind => channel.id === categories[kind].id))
    .sort(comparePosition);
  const orderedCategories = [...CATEGORY_ORDER.map(kind => categories[kind]), ...others];
  if (orderedCategories.some((channel, position) => channel.position !== position)) {
    const response = await discordBotRequest(`/guilds/${GUILD_ID}/channels`, {
      method: "PATCH",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(orderedCategories.map((channel, position) => ({ id: channel.id, position }))),
    }, fetcher);
    if (!response.ok) {
      throw new DiscordApiError(response.status, `/guilds/${GUILD_ID}/channels`, "PATCH", null);
    }
  }

  const ticketSnapshots: Array<{ channel: TicketCategoryChannel; parentId: string }> = [];
  const movedChannelIds: string[] = [];
  for (const channel of categories.channels) {
    if (!isGuildChannel(channel) || channel.type !== 0) continue;
    const kind = classifyTicket(channel.topic, orderKinds);
    if (!kind) continue;
    const parentId = categories[kind].id;
    ticketSnapshots.push({ channel: structuredClone(channel), parentId });
    if (channel.parent_id === parentId) continue;
    // Never synchronize permissions to the category or touch a ticket's closed state.
    await discordBotJson<TicketCategoryChannel>(`/channels/${channel.id}`, {
      method: "PATCH",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ parent_id: parentId }),
    }, fetcher);
    movedChannelIds.push(channel.id);
  }

  const verified = await listChannels(fetcher);
  const verifiedCategories = verified.filter(channel => isGuildChannel(channel) && channel.type === 4).sort(comparePosition);
  if (verifiedCategories.length !== orderedCategories.length
    || verifiedCategories.some((channel, index) => channel.id !== orderedCategories[index].id)
    || CATEGORY_ORDER.some((_, index) => verifiedCategories[index]?.position !== index)) {
    throw new Error("Discord não confirmou a ordem das categorias de tickets.");
  }
  for (const kind of CATEGORY_ORDER) {
    const category = findCategory(verified, kind);
    if (!category || category.id !== categories[kind].id) {
      throw new Error("Discord não confirmou as categorias de tickets.");
    }
    assertCategory(category, kind, categories.botId);
  }
  for (const { channel: before, parentId } of ticketSnapshots) {
    const after = verified.find(channel => channel.id === before.id && isGuildChannel(channel));
    if (!after || after.parent_id !== parentId || after.name !== before.name || after.topic !== before.topic
      || !samePermissionOverwrites(after.permission_overwrites ?? [], before.permission_overwrites ?? [])) {
      throw new Error("Discord não confirmou a categoria e a preservação do ticket.");
    }
  }
  return {
    status: "synchronized" as const,
    purchaseCategoryId: categories.purchase.id,
    upCategoryId: categories.up.id,
    saleCategoryId: categories.sale.id,
    createdCategoryIds: categories.createdCategoryIds,
    movedChannelIds,
  };
}

function ensureCategories(fetcher: typeof fetch): Promise<EnsuredCategories> {
  const active = categoryTasks.get(fetcher);
  if (active) return active;
  const task = ensureCategoriesInternal(fetcher).finally(() => {
    if (categoryTasks.get(fetcher) === task) categoryTasks.delete(fetcher);
  });
  categoryTasks.set(fetcher, task);
  return task;
}

async function ensureCategoriesInternal(fetcher: typeof fetch): Promise<EnsuredCategories> {
  const botId = await assertConfiguredDiscordBotIdentity(fetcher);
  const channels = await listChannels(fetcher);
  // Detect duplicates before changing any category.
  const existing = {
    purchase: findCategory(channels, "purchase"),
    up: findCategory(channels, "up"),
    sale: findCategory(channels, "sale"),
  };
  const createdCategoryIds: string[] = [];
  const permissions = categoryPermissions(botId);
  const resolved = {} as Record<TicketCategoryKind, TicketCategoryChannel>;
  for (const kind of CATEGORY_ORDER) {
    let category = existing[kind];
    if (!category) {
      category = await discordBotJson<TicketCategoryChannel>(`/guilds/${GUILD_ID}/channels`, {
        method: "POST", signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ name: CATEGORY_NAMES[kind], type: 4, permission_overwrites: permissions }),
      }, fetcher);
      assertCategory(category, kind, botId);
      channels.push(category);
      createdCategoryIds.push(category.id);
    } else if (category.name !== CATEGORY_NAMES[kind]
      || !samePermissionOverwrites(category.permission_overwrites ?? [], permissions)) {
      const repaired = await discordBotJson<TicketCategoryChannel>(`/channels/${category.id}`, {
        method: "PATCH", signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ name: CATEGORY_NAMES[kind], permission_overwrites: permissions }),
      }, fetcher);
      assertCategory(repaired, kind, botId);
      channels[channels.findIndex(channel => channel.id === category!.id)] = repaired;
      category = repaired;
    }
    assertCategory(category, kind, botId);
    resolved[kind] = category;
  }
  return { channels, ...resolved, botId, createdCategoryIds };
}

function findCategory(channels: readonly TicketCategoryChannel[], kind: TicketCategoryKind) {
  const canonical = { purchase: "compra", up: "upper", sale: "venda" }[kind];
  const matches = channels.filter(channel => isGuildChannel(channel) && channel.type === 4
    && canonicalName(channel.name ?? "") === canonical);
  if (matches.length > 1) throw new Error(`Há mais de uma categoria de ${canonical} na GWStore.`);
  return matches[0] ?? null;
}

function ticketOrderId(topic: string | null | undefined): string | null {
  if (!topic) return null;
  const match = ORDER_TOPIC.exec(topic);
  return match ? (match[1] ?? match[2]).toLowerCase() : null;
}

function classifyTicket(topic: string | null | undefined, orderKinds: ReadonlyMap<string, "purchase" | "up">): TicketCategoryKind | null {
  if (!topic) return null;
  if (PURCHASE_TOPIC.test(topic)) {
    const orderId = ticketOrderId(topic);
    return orderId ? orderKinds.get(orderId) ?? "purchase" : "purchase";
  }
  if (!topic.startsWith(SALE_TOPIC_PREFIX)) return null;
  try {
    const offer: unknown = JSON.parse(topic.slice(SALE_TOPIC_PREFIX.length));
    if (typeof offer !== "object" || offer === null || Array.isArray(offer)) return null;
    const value = offer as Record<string, unknown>;
    return typeof value.requestId === "string" && SNOWFLAKE.test(value.requestId)
      && typeof value.sellerId === "string" && SNOWFLAKE.test(value.sellerId)
      && typeof value.itemName === "string" && value.itemName.length >= 1 && value.itemName.length <= 120
      && (value.status === "open" || value.status === "completed")
      && (value.welcomeId === undefined || (typeof value.welcomeId === "string" && SNOWFLAKE.test(value.welcomeId)))
      && (value.completedBy === undefined || (typeof value.completedBy === "string" && SNOWFLAKE.test(value.completedBy)))
      ? "sale" : null;
  } catch { return null; }
}

function categoryPermissions(botId: string): DiscordPermissionOverwrite[] {
  return [
    { id: GUILD_ID, type: 0, allow: "0", deny: VIEW_CHANNEL.toString() },
    { id: botId, type: 1, allow: (VIEW_CHANNEL | MANAGE_CHANNELS).toString(), deny: "0" },
  ];
}

function assertCategory(channel: TicketCategoryChannel, kind: TicketCategoryKind, botId: string) {
  if (!isGuildChannel(channel) || channel.type !== 4 || channel.name !== CATEGORY_NAMES[kind]
    || !samePermissionOverwrites(channel.permission_overwrites ?? [], categoryPermissions(botId))) {
    throw new Error("Discord não confirmou a categoria privada de tickets.");
  }
}

function isGuildChannel(channel: TicketCategoryChannel) {
  return SNOWFLAKE.test(channel.id) && (!channel.guild_id || channel.guild_id === GUILD_ID);
}

function canonicalName(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function comparePosition(a: TicketCategoryChannel, b: TicketCategoryChannel) {
  const position = (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);
  return position || a.id.localeCompare(b.id);
}

async function listChannels(fetcher: typeof fetch) {
  const channels = await discordBotJson<TicketCategoryChannel[]>(`/guilds/${GUILD_ID}/channels`, {}, fetcher);
  if (!Array.isArray(channels)) throw new Error("Lista de canais Discord inválida.");
  return channels;
}
