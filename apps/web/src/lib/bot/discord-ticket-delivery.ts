import "server-only";

import { createHash } from "node:crypto";

import { STORE_NAME } from "@/lib/brand";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordApiUrl,
  discordBotJson,
} from "./discord-api";
import type { BotRuntimeSettings } from "./message-customization-server";
import { interpolateBotMessageLimited } from "./message-customization";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_CHANNEL_MESSAGE = 4;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const DISCORD_MESSAGE_PAGE_SIZE = 100;
const MAXIMUM_MESSAGE_PAGES = 10;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const INTERACTION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{20,500}$/;
const DELIVERED_CHANNEL_PREFIX = "✅・entregue-";
const DISCORD_CHANNEL_NAME_MAX_LENGTH = 100;

export const TICKET_DELIVERY_INTERACTION_PREFIX = "gwstore_ticket_delivery:";

type DiscordChannel = {
  id?: unknown;
  guild_id?: unknown;
  type?: unknown;
  name?: unknown;
};

type DiscordMessage = {
  id?: unknown;
  author?: { id?: unknown };
  content?: unknown;
  nonce?: unknown;
};

export type PaidTicketDeliveryOrder = {
  source?: "items" | "robux";
  orderId: string;
  guildId: string;
  buyerDiscordId: string;
  channelId: string;
  ticketStatus: string;
  orderStatus: string;
  paymentStatus: string;
  paidAt: string | null;
  itemSummary: Array<{ name: string; quantity: number }>;
  totalCents: number;
};

export interface DiscordTicketDeliveryRepository {
  find(orderId: string): Promise<PaidTicketDeliveryOrder | null>;
  complete(input: {
    source?: "robux";
    orderId: string;
    discordGuildId: string;
    ticketChannelId: string;
    deliveredByDiscordUserId: string;
  }): Promise<{
    orderId: string;
    wasCompleted: boolean;
    deliveryCompletedAt: string;
    autoCloseAt: string;
  }>;
}

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;
type DeliveryRpcRow = {
  completed_order_id: string;
  was_completed: boolean;
  order_status: string;
  ticket_status: string;
  ticket_channel_id: string;
  delivery_completed_at: string;
  auto_close_at: string;
  delivered_by_discord_user_id: string;
};
type UntypedRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => {
    single: () => Promise<{ data: DeliveryRpcRow; error: { message: string } | null }>;
  };
};

export class SupabaseDiscordTicketDeliveryRepository
  implements DiscordTicketDeliveryRepository
{
  constructor(private readonly client: AdminClient = requireAdminClient()) {}

  async find(orderId: string): Promise<PaidTicketDeliveryOrder | null> {
    const { data: order, error: orderError } = await this.client
      .from("orders")
      .select(
        "id,guild_id,buyer_discord_id,status,payment_status,paid_at,sale_price_cents,discord_ticket_status,discord_ticket_channel_id",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (order?.discord_ticket_channel_id) {
      const { data: guild, error: guildError } = await this.client
        .from("guilds")
        .select("discord_guild_id")
        .eq("id", order.guild_id)
        .maybeSingle();
      if (guildError) throw new Error(guildError.message);
      if (!guild) return null;

      const { data: items, error: itemsError } = await this.client
        .from("order_items")
        .select("quantity,products(name)")
        .eq("order_id", order.id)
        .order("position");
      if (itemsError) throw new Error(itemsError.message);

      return {
        source: "items",
        orderId: order.id,
        guildId: guild.discord_guild_id,
        buyerDiscordId: order.buyer_discord_id,
        channelId: order.discord_ticket_channel_id,
        ticketStatus: order.discord_ticket_status,
        orderStatus: order.status,
        paymentStatus: order.payment_status,
        paidAt: order.paid_at,
        itemSummary: (items ?? []).map((item) => ({
          name: item.products?.name ?? "Produto",
          quantity: Math.max(Number(item.quantity) || 1, 1),
        })),
        totalCents: Math.max(Number(order.sale_price_cents) || 0, 0),
      };
    }

    const { data: robuxOrder, error: robuxOrderError } = await this.client
      .from("robux_orders")
      .select(
        "id,guild_id,buyer_discord_id,status,payment_status,paid_at,amount_cents,discord_ticket_status,discord_ticket_channel_id",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (robuxOrderError) throw new Error(robuxOrderError.message);
    if (!robuxOrder?.discord_ticket_channel_id) return null;

    const { data: robuxGuild, error: robuxGuildError } = await this.client
      .from("guilds")
      .select("discord_guild_id")
      .eq("id", robuxOrder.guild_id)
      .maybeSingle();
    if (robuxGuildError) throw new Error(robuxGuildError.message);
    if (!robuxGuild) return null;

    return {
      source: "robux",
      orderId: robuxOrder.id,
      guildId: robuxGuild.discord_guild_id,
      buyerDiscordId: robuxOrder.buyer_discord_id,
      channelId: robuxOrder.discord_ticket_channel_id,
      ticketStatus: robuxOrder.discord_ticket_status,
      orderStatus: robuxOrder.status,
      paymentStatus: robuxOrder.payment_status,
      paidAt: robuxOrder.paid_at,
      itemSummary: [{ name: "Robux", quantity: 1 }],
      totalCents: Math.max(Number(robuxOrder.amount_cents) || 0, 0),
    };
  }

  async complete(input: {
    source?: "robux";
    orderId: string;
    discordGuildId: string;
    ticketChannelId: string;
    deliveredByDiscordUserId: string;
  }) {
    const rpcName =
      input.source === "robux"
        ? "complete_robux_discord_ticket_delivery"
        : "complete_paid_order_discord_delivery";
    const { data, error } = await (this.client as unknown as UntypedRpcClient)
      .rpc(rpcName, {
        p_order_id: input.orderId,
        p_discord_guild_id: input.discordGuildId,
        p_ticket_channel_id: input.ticketChannelId,
        p_delivered_by_discord_user_id: input.deliveredByDiscordUserId,
      })
      .single();
    if (error) throw new Error(error.message);
    if (
      data.completed_order_id !== input.orderId ||
      data.order_status !== (input.source === "robux" ? "paid" : "delivered") ||
      data.ticket_status !== "open" ||
      data.ticket_channel_id !== input.ticketChannelId ||
      data.delivered_by_discord_user_id !== input.deliveredByDiscordUserId ||
      typeof data.was_completed !== "boolean" ||
      typeof data.delivery_completed_at !== "string" ||
      Number.isNaN(Date.parse(data.delivery_completed_at)) ||
      typeof data.auto_close_at !== "string" ||
      Number.isNaN(Date.parse(data.auto_close_at)) ||
      Date.parse(data.auto_close_at) - Date.parse(data.delivery_completed_at) !==
        30 * 60 * 1_000
    ) {
      throw new Error("Supabase retornou uma conclusão de entrega inválida.");
    }
    return {
      orderId: data.completed_order_id,
      wasCompleted: data.was_completed,
      deliveryCompletedAt: data.delivery_completed_at,
      autoCloseAt: data.auto_close_at,
    };
  }
}

export type NativeDiscordTicketDeliveryInteraction = {
  orderId: string;
};

export function ticketDeliveryInteractionId(orderId: string) {
  const normalized = orderId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error("ID do pedido inválido.");
  return `${TICKET_DELIVERY_INTERACTION_PREFIX}${normalized}`;
}

export function parseNativeDiscordTicketDeliveryInteraction(
  raw: unknown,
): NativeDiscordTicketDeliveryInteraction | null {
  if (!isObject(raw) || raw.type !== DISCORD_MESSAGE_COMPONENT || !isObject(raw.data)) {
    return null;
  }
  if (typeof raw.data.custom_id !== "string") return null;
  if (!raw.data.custom_id.startsWith(TICKET_DELIVERY_INTERACTION_PREFIX)) return null;
  const orderId = raw.data.custom_id.slice(TICKET_DELIVERY_INTERACTION_PREFIX.length);
  return UUID_PATTERN.test(orderId) ? { orderId: orderId.toLowerCase() } : null;
}

export function createNativeDiscordTicketDeliveryResponse(
  raw: unknown,
  settings: BotRuntimeSettings,
) {
  const interaction = parseNativeDiscordTicketDeliveryInteraction(raw);
  const context = readInteractionContext(raw);
  const authorized = Boolean(
    interaction &&
      context &&
      settings.ticketCloseAdminDiscordUserIds.includes(context.userId),
  );

  return {
    authorized,
    response: authorized
      ? {
          type: DISCORD_DEFERRED_CHANNEL_MESSAGE,
          data: { flags: DISCORD_EPHEMERAL_FLAG },
        }
      : ephemeralResponse(settings.customization.ticket.deliveryUnauthorizedText),
  };
}

export async function completeDiscordTicketDelivery(
  raw: unknown,
  settings: BotRuntimeSettings,
  options: {
    repository?: DiscordTicketDeliveryRepository;
    fetcher?: typeof fetch;
  } = {},
) {
  const interaction = parseNativeDiscordTicketDeliveryInteraction(raw);
  const context = readInteractionContext(raw, true);
  const message = settings.customization.ticket;
  const fetcher = options.fetcher ?? fetch;

  if (
    !interaction ||
    !context ||
    !settings.ticketCloseAdminDiscordUserIds.includes(context.userId)
  ) {
    await updateOriginalInteractionSafely(raw, message.deliveryUnauthorizedText, fetcher);
    return { status: "unauthorized" as const };
  }

  try {
    const repository =
      options.repository ?? new SupabaseDiscordTicketDeliveryRepository();
    const order = await repository.find(interaction.orderId);
    if (!order || !isEligibleOrder(order, interaction.orderId, context)) {
      await updateOriginalInteractionSafely(raw, message.deliveryUnavailableText, fetcher);
      return { status: "unavailable" as const };
    }

    const botUserId = await assertConfiguredDiscordBotIdentity(fetcher);
    await assertDiscordBotGuildAccess(context.guildId, fetcher);
    const channels = await listTextChannels(context.guildId, fetcher);
    const feedbackChannelId = findFeedbackChannelId(channels);
    const deliveryLogChannelId = findDeliveryLogChannelId(channels);
    const content = buildDeliveryMessage(
      order.buyerDiscordId,
      message.deliveryMessageText,
      feedbackChannelId,
    );

    const alreadySent = await channelHasDeliveryMessage(
      context.channelId,
      order.orderId,
      order.buyerDiscordId,
      botUserId,
      fetcher,
    );
    if (!alreadySent) {
      const sent = await discordBotJson<DiscordMessage>(
        `/channels/${context.channelId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            content,
            allowed_mentions: {
              parse: [],
              users: [order.buyerDiscordId],
              replied_user: false,
            },
            nonce: deliveryMessageNonce(order.orderId),
            enforce_nonce: true,
          }),
        },
        fetcher,
      );
      if (typeof sent.id !== "string" || !SNOWFLAKE_PATTERN.test(sent.id)) {
        throw new Error("Discord retornou uma mensagem de entrega inválida.");
      }
    }

    await renameDeliveredTicketChannel(
      context.channelId,
      context.guildId,
      order.orderId,
      fetcher,
    );
    const completed = await repository.complete({
      orderId: order.orderId,
      discordGuildId: context.guildId,
      ticketChannelId: context.channelId,
      deliveredByDiscordUserId: context.userId,
      ...(order.source === "robux" ? { source: "robux" as const } : {}),
    });

    if (completed.wasCompleted && deliveryLogChannelId) {
      try {
        await publishDeliveryLog(
          deliveryLogChannelId,
          order,
          fetcher,
        );
      } catch (logError) {
        const logMessage = logError instanceof Error ? logError.message : "erro desconhecido";
        // A entrega foi concluída no banco. O registro público é adicional e
        // nunca pode transformar uma entrega válida em um erro para o admin.
        console.error(`[discord-ticket-delivery:log] ${logMessage}`);
      }
    }

    await updateOriginalInteractionSafely(
      raw,
      alreadySent ? message.deliveryAlreadySentText : message.deliverySuccessText,
      fetcher,
    );
    if (alreadySent) return { status: "already_sent" as const };
    return {
      status: "sent" as const,
      buyerDiscordId: order.buyerDiscordId,
      feedbackChannelId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-ticket-delivery] ${errorMessage}`);
    await updateOriginalInteractionSafely(raw, message.deliveryUnavailableText, fetcher);
    return { status: "unavailable" as const };
  }
}

export function buildDeliveryMessage(
  buyerDiscordId: string,
  deliveryMessageText: string,
  feedbackChannelId: string | null,
) {
  if (!SNOWFLAKE_PATTERN.test(buyerDiscordId)) {
    throw new Error("ID do comprador inválido para a mensagem de entrega.");
  }
  const body = interpolateBotMessageLimited(deliveryMessageText, {}, 1_800);
  const feedbackLine = feedbackChannelId
    ? `<#${feedbackChannelId}>`
    : "Procure o canal de feedbacks no servidor.";
  return `<@${buyerDiscordId}>\n${body}\n${feedbackLine}`;
}

export function buildDeliveryLogMessage(order: PaidTicketDeliveryOrder) {
  const itemLines = order.itemSummary.length
    ? order.itemSummary
        .slice(0, 10)
        .map((item) => `• ${item.quantity}× ${item.name}`)
        .join("\n")
    : "• Itens registrados no ticket privado";
  const totalLine = order.totalCents > 0 ? `\nTotal pago: ${formatBrl(order.totalCents)}` : "";
  return [
    "✅ **Compra entregue**",
    `Comprador: <@${order.buyerDiscordId}>`,
    "",
    "**Itens**",
    itemLines,
    totalLine,
  ].join("\n").trim();
}

export function buildDeliveredTicketChannelName(currentName: string) {
  const trimmed = currentName.trim();
  if (!trimmed) throw new Error("Canal Discord sem nome para marcar como entregue.");
  const baseName =
    trimmed.replace(/^(?:✅[\s・|┊_-]*)?entregue[\s・|┊_-]*/iu, "") || "ticket";
  const availableLength =
    DISCORD_CHANNEL_NAME_MAX_LENGTH - Array.from(DELIVERED_CHANNEL_PREFIX).length;
  return `${DELIVERED_CHANNEL_PREFIX}${Array.from(baseName)
    .slice(0, availableLength)
    .join("")}`;
}

async function renameDeliveredTicketChannel(
  channelId: string,
  guildId: string,
  orderId: string,
  fetcher: typeof fetch,
) {
  const channel = await discordBotJson<DiscordChannel>(
    `/channels/${channelId}`,
    {},
    fetcher,
  );
  if (
    channel.id !== channelId ||
    channel.guild_id !== guildId ||
    channel.type !== 0 ||
    typeof channel.name !== "string"
  ) {
    throw new Error("Discord retornou um canal de ticket inválido.");
  }
  const name = buildDeliveredTicketChannelName(channel.name);
  if (channel.name === name) return;

  const renamed = await discordBotJson<DiscordChannel>(
    `/channels/${channelId}`,
    {
      method: "PATCH",
      headers: {
        "X-Audit-Log-Reason": encodeURIComponent(
          `${STORE_NAME} ticket ${orderId} marked delivered`,
        ),
      },
      body: JSON.stringify({ name }),
    },
    fetcher,
  );
  if (renamed.id !== channelId || renamed.name !== name) {
    throw new Error("Discord não confirmou o novo nome do ticket entregue.");
  }
}

async function listTextChannels(guildId: string, fetcher: typeof fetch) {
  const channels = await discordBotJson<DiscordChannel[]>(
    `/guilds/${guildId}/channels`,
    {},
    fetcher,
  );
  return channels.filter(
    (channel): channel is DiscordChannel & { id: string; name: string } =>
      typeof channel.id === "string" &&
      SNOWFLAKE_PATTERN.test(channel.id) &&
      channel.type === 0 &&
      typeof channel.name === "string",
  );
}

function findFeedbackChannelId(candidates: Array<DiscordChannel & { id: string; name: string }>) {
  const exact = candidates.find((channel) => {
    const name = canonicalChannelName(channel.name);
    return name === "feedback" || name === "feedbacks";
  });
  if (exact) return exact.id;

  const partial = candidates.filter((channel) =>
    canonicalChannelName(channel.name).includes("feedback"),
  );
  return partial.length === 1 ? partial[0].id : null;
}

function findDeliveryLogChannelId(
  candidates: Array<DiscordChannel & { id: string; name: string }>,
) {
  const exact = candidates.find((channel) => {
    const name = canonicalChannelName(channel.name);
    return name === "entregas" || name === "entrega" || name === "delivery";
  });
  if (exact) return exact.id;

  const partial = candidates.filter((channel) => {
    const name = canonicalChannelName(channel.name);
    return name.includes("entrega") || name.includes("delivery");
  });
  return partial.length === 1 ? partial[0].id : null;
}

async function publishDeliveryLog(
  channelId: string,
  order: PaidTicketDeliveryOrder,
  fetcher: typeof fetch,
) {
  const sent = await discordBotJson<DiscordMessage>(
    `/channels/${channelId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: buildDeliveryLogMessage(order),
        allowed_mentions: { parse: [], replied_user: false },
        nonce: deliveryLogNonce(order.orderId),
        enforce_nonce: true,
      }),
    },
    fetcher,
  );
  if (typeof sent.id !== "string" || !SNOWFLAKE_PATTERN.test(sent.id)) {
    throw new Error("Discord retornou um registro de entrega inválido.");
  }
}

async function channelHasDeliveryMessage(
  channelId: string,
  orderId: string,
  buyerDiscordId: string,
  botUserId: string,
  fetcher: typeof fetch,
) {
  let before: string | null = null;
  const expectedNonce = deliveryMessageNonce(orderId);
  for (let pageIndex = 0; pageIndex < MAXIMUM_MESSAGE_PAGES; pageIndex += 1) {
    const page: DiscordMessage[] = await discordBotJson<DiscordMessage[]>(
      `/channels/${channelId}/messages?limit=${DISCORD_MESSAGE_PAGE_SIZE}${
        before ? `&before=${before}` : ""
      }`,
      {},
      fetcher,
    );
    if (
      page.some(
        (message) =>
          message.author?.id === botUserId &&
          (message.nonce === expectedNonce ||
            (typeof message.content === "string" &&
              message.content.startsWith(`<@${buyerDiscordId}>\n`) &&
              message.content.includes("✅ Entrega concluída!") &&
              message.content.includes("Obrigado pela preferência"))),
      )
    ) {
      return true;
    }
    if (page.length < DISCORD_MESSAGE_PAGE_SIZE) return false;
    const lastId: unknown = page.at(-1)?.id;
    if (typeof lastId !== "string" || !SNOWFLAKE_PATTERN.test(lastId)) return false;
    before = lastId;
  }
  return false;
}

function isEligibleOrder(
  order: PaidTicketDeliveryOrder,
  orderId: string,
  context: NonNullable<ReturnType<typeof readInteractionContext>>,
) {
  return (
    order.orderId === orderId &&
    order.guildId === context.guildId &&
    order.channelId === context.channelId &&
    order.ticketStatus === "open" &&
    (order.source === "robux"
      ? order.orderStatus === "paid"
      : ["paid", "processing", "delivered"].includes(order.orderStatus)) &&
    order.paymentStatus === "paid" &&
    order.paidAt !== null &&
    SNOWFLAKE_PATTERN.test(order.buyerDiscordId)
  );
}

function readInteractionContext(raw: unknown, requireWebhook = false) {
  if (!isObject(raw)) return null;
  const guildId = asSnowflake(raw.guild_id);
  const channelId = asSnowflake(raw.channel_id);
  const member = isObject(raw.member) ? raw.member : null;
  const memberUser = member && isObject(member.user) ? member.user : null;
  const directUser = isObject(raw.user) ? raw.user : null;
  const userId = asSnowflake(memberUser?.id) ?? asSnowflake(directUser?.id);
  if (!guildId || !channelId || !userId) return null;

  if (!requireWebhook) return { guildId, channelId, userId };
  const applicationId = asSnowflake(raw.application_id);
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const token = typeof raw.token === "string" ? raw.token : "";
  if (
    !applicationId ||
    applicationId !== configuredApplicationId ||
    !INTERACTION_TOKEN_PATTERN.test(token)
  ) {
    return null;
  }
  return { guildId, channelId, userId, applicationId, token };
}

async function updateOriginalInteraction(
  raw: unknown,
  content: string,
  fetcher: typeof fetch,
) {
  const context = readInteractionContext(raw, true);
  if (!context) throw new Error("Contexto da interação Discord inválido.");
  const response = await fetcher(
    `${discordApiUrl()}/webhooks/${context.applicationId}/${context.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, components: [], allowed_mentions: { parse: [] } }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord recusou a atualização da entrega (${response.status}).`);
  }
}

async function updateOriginalInteractionSafely(
  raw: unknown,
  content: string,
  fetcher: typeof fetch,
) {
  try {
    await updateOriginalInteraction(raw, content, fetcher);
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-ticket-delivery:interaction_update] ${message}`);
  }
}

function ephemeralResponse(content: string) {
  return {
    type: DISCORD_CHANNEL_MESSAGE,
    data: {
      content: interpolateBotMessageLimited(content, {}, 1_000),
      flags: DISCORD_EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
      components: [],
    },
  };
}

function deliveryMessageNonce(orderId: string) {
  return createHash("sha256")
    .update(`gwstore:delivery-feedback:${orderId}`)
    .digest("hex")
    .slice(0, 25);
}

function deliveryLogNonce(orderId: string) {
  return createHash("sha256")
    .update(`gwstore:delivery-log:${orderId}`)
    .digest("hex")
    .slice(0, 25);
}

function formatBrl(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function canonicalChannelName(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function requireAdminClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function asSnowflake(value: unknown) {
  return typeof value === "string" && SNOWFLAKE_PATTERN.test(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
