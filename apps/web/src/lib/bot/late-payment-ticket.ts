import "server-only";

import {
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordBotJson,
} from "./discord-api";
import {
  buildTicketPermissionOverwrites,
  samePermissionOverwrites,
  type DiscordPermissionOverwrite,
} from "./discord-ticket-controls";
import { loadBotRuntimeSettings } from "./message-customization-server";
import { STORE_NAME } from "@/lib/brand";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { formatBrl } from "@godawp/domain";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

type DiscordChannel = {
  id: string;
  type: number;
  topic?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

export type LatePaymentTicketInput = {
  orderId: string;
  guildDiscordId: string;
  buyerDiscordId: string;
  productName: string;
  quantity: number;
  amountCents: number;
  reason?: "late_payment" | "stock_unavailable_after_payment";
};

/** Marker kept on the channel topic so a retry finds the channel it created. */
export function latePaymentTicketMarker(orderId: string) {
  return `gwstore:late-payment:${orderId}`;
}

function ticketChannelName(orderId: string) {
  return `pagamento-atrasado-${orderId.slice(0, 6)}`.slice(0, 90);
}

/**
 * Opens the channel where a buyer who paid after the deadline gets an answer.
 *
 * It deliberately carries no delivery button: the order is cancelled as far as
 * the pipeline is concerned, so the team decides here whether to hand the item
 * over or send the money back. What matters is that the buyer is never left
 * without somewhere to ask.
 */
export async function ensureLatePaymentTicket(
  input: LatePaymentTicketInput,
  options: { fetcher?: typeof fetch } = {},
) {
  if (!UUID_PATTERN.test(input.orderId))
    throw new Error("ID do pedido inválido.");
  if (!SNOWFLAKE_PATTERN.test(input.guildDiscordId)) {
    throw new Error("Servidor do pedido inválido.");
  }
  if (!SNOWFLAKE_PATTERN.test(input.buyerDiscordId)) {
    throw new Error("Comprador do pedido inválido.");
  }

  const fetcher = options.fetcher ?? fetch;
  const [botUserId, settings] = await Promise.all([
    assertConfiguredDiscordBotIdentity(fetcher),
    loadBotRuntimeSettings(),
  ]);
  await assertDiscordBotGuildAccess(input.guildDiscordId, fetcher);

  const marker = latePaymentTicketMarker(input.orderId);
  const overwrites = buildTicketPermissionOverwrites({
    guildId: input.guildDiscordId,
    buyerDiscordId: input.buyerDiscordId,
    botDiscordId: botUserId,
    closerDiscordUserIds: settings.ticketCloseAdminDiscordUserIds,
    notificationDiscordUserIds: settings.ticketNotificationDiscordUserIds,
  });

  const channels = await discordBotJson<DiscordChannel[]>(
    `/guilds/${input.guildDiscordId}/channels`,
    {},
    fetcher,
  );
  let channel = channels.find(
    (candidate) => candidate.type === 0 && candidate.topic?.startsWith(marker),
  );
  let created = false;

  if (!channel) {
    channel = await discordBotJson<DiscordChannel>(
      `/guilds/${input.guildDiscordId}/channels`,
      {
        method: "POST",
        headers: {
          "X-Audit-Log-Reason": encodeURIComponent(
            `${STORE_NAME} late payment ${input.orderId}`,
          ),
        },
        body: JSON.stringify({
          name: ticketChannelName(input.orderId),
          type: 0,
          topic: marker,
          permission_overwrites: overwrites,
        }),
      },
      fetcher,
    );
    created = true;
  } else if (
    !samePermissionOverwrites(channel.permission_overwrites ?? [], overwrites)
  ) {
    channel = await discordBotJson<DiscordChannel>(
      `/channels/${channel.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ permission_overwrites: overwrites }),
      },
      fetcher,
    );
  }

  if (!SNOWFLAKE_PATTERN.test(channel.id)) {
    throw new Error("Discord retornou um canal inválido.");
  }

  if (created) {
    const stockUnavailable = input.reason === "stock_unavailable_after_payment";
    const staffMentions = [
      ...new Set(settings.ticketNotificationDiscordUserIds),
    ]
      .map((id) => `<@${id}>`)
      .join(" ");
    await discordBotJson(
      `/channels/${channel.id}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content: `<@${input.buyerDiscordId}>${staffMentions ? ` ${staffMentions}` : ""}`,
          embeds: [
            {
              title: stockUnavailable
                ? "Pagamento confirmado, mas o item esgotou"
                : "Seu pagamento chegou depois do prazo",
              description: stockUnavailable
                ? "Seu Pix foi confirmado, mas outra compra consumiu as últimas unidades antes da confirmação do estoque. " +
                  `**O seu dinheiro não se perdeu.** A equipe da ${STORE_NAME} resolve por aqui: oferece uma alternativa ou devolve o valor. ` +
                  "É só responder nesta conversa."
                : "O Pix caiu depois que o pedido expirou, então ele foi cancelado automaticamente e o item não saiu. " +
                  `**O seu dinheiro não se perdeu.** A equipe da ${STORE_NAME} resolve por aqui: entrega o item ou devolve o valor. ` +
                  "É só responder nesta conversa.",
              color: 0xf59e0b,
              fields: [
                {
                  name: "Pedido",
                  value: `${input.quantity}x ${input.productName}`.slice(
                    0,
                    1024,
                  ),
                  inline: false,
                },
                {
                  name: "Valor pago",
                  value: formatBrl(input.amountCents),
                  inline: true,
                },
              ],
              footer: { text: `Pedido ${input.orderId}` },
            },
          ],
          allowed_mentions: { parse: [], users: [input.buyerDiscordId] },
        }),
      },
      fetcher,
    );
  }

  return { channelId: channel.id, created };
}

/**
 * Every five minutes, gives a channel to anyone whose money arrived late and who
 * still has nowhere to ask. It is the safety net behind the webhook: a deploy, a
 * Discord outage or a provider retry storm must not cost a buyer their money.
 */
export async function reconcileLatePaidOrderTickets(
  options: { fetcher?: typeof fetch; limit?: number } = {},
) {
  const client = createAdminSupabaseClient();
  if (!client) return { pending: 0, opened: 0, failed: 0 };

  const { data, error } = await client.rpc(
    "list_late_paid_orders_without_ticket",
    {
      p_limit: options.limit ?? 25,
    },
  );
  if (error) {
    console.error(`[pagamento-atrasado] ${error.message}`);
    return { pending: 0, opened: 0, failed: 0 };
  }

  const pending = data ?? [];
  let opened = 0;
  let failed = 0;

  for (const order of pending) {
    try {
      const ticket = await ensureLatePaymentTicket(
        {
          orderId: order.late_order_id,
          guildDiscordId: order.late_guild_discord_id,
          buyerDiscordId: order.late_buyer_discord_id,
          productName: order.late_product_name,
          quantity: order.late_quantity,
          amountCents: order.late_amount_cents,
          reason:
            order.late_reason === "stock_unavailable_after_payment"
              ? "stock_unavailable_after_payment"
              : "late_payment",
        },
        { fetcher: options.fetcher },
      );
      const { error: recordError } = await client.rpc(
        "record_late_payment_ticket",
        {
          p_order_id: order.late_order_id,
          p_channel_id: ticket.channelId,
        },
      );
      if (recordError) throw new Error(recordError.message);
      opened += 1;
    } catch (error) {
      failed += 1;
      const detail =
        error instanceof Error ? error.message : "erro desconhecido";
      // Loud on purpose: a buyer is out of pocket until this succeeds.
      console.error(
        `[pagamento-atrasado] pedido ${order.late_order_id}: ${detail}`,
      );
    }
  }

  return { pending: pending.length, opened, failed };
}
