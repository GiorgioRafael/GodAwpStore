import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { DiscordCartSelection } from "./discord-cart-selection";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

type RecoveryDm = {
  channelId: string;
  messageId: string;
} | null;

export type BuyerOrderCancellationResult =
  | {
      kind: "cancelled";
      orderId: string;
      canRebuild: true;
      stockChanged: boolean;
      recoveryDm: RecoveryDm;
    }
  | {
      kind: "already_cancelled";
      orderId: string;
      canRebuild: true;
      stockChanged: false;
      recoveryDm: RecoveryDm;
    }
  | {
      kind: "payment_confirmed";
      orderId: string;
      canRebuild: false;
      stockChanged: false;
      recoveryDm: null;
    }
  | {
      kind: "unavailable";
      orderId: string;
      canRebuild: false;
      stockChanged: false;
      recoveryDm: null;
    };

export class SupabaseOrderCancellationRepository {
  constructor(private readonly client: AdminClient = requireClient()) {}

  async cancel(input: {
    orderId: string;
    discordGuildId: string;
    buyerDiscordId: string;
  }): Promise<BuyerOrderCancellationResult> {
    const { data, error } = await this.client
      .rpc("cancel_discord_unpaid_order", {
        p_order_id: input.orderId,
        p_discord_guild_id: input.discordGuildId,
        p_buyer_discord_id: input.buyerDiscordId,
      })
      .single();
    assertQuery(error, "cancelamento do pedido");
    const recoveryDm = readRecoveryDm(
      data.recovery_dm_channel_id,
      data.recovery_dm_message_id,
    );

    if (data.was_cancelled && data.can_rebuild) {
      return {
        kind: "cancelled",
        orderId: data.cancelled_order_id,
        canRebuild: true,
        stockChanged: data.stock_changed,
        recoveryDm,
      };
    }
    if (data.already_cancelled && data.can_rebuild) {
      return {
        kind: "already_cancelled",
        orderId: data.cancelled_order_id,
        canRebuild: true,
        stockChanged: false,
        recoveryDm,
      };
    }
    if (data.payment_confirmed) {
      return {
        kind: "payment_confirmed",
        orderId: data.cancelled_order_id,
        canRebuild: false,
        stockChanged: false,
        recoveryDm: null,
      };
    }
    return {
      kind: "unavailable",
      orderId: data.cancelled_order_id,
      canRebuild: false,
      stockChanged: false,
      recoveryDm: null,
    };
  }

  async loadRebuildSelections(input: {
    orderId: string;
    discordGuildId: string;
    buyerDiscordId: string;
  }): Promise<DiscordCartSelection[] | null> {
    const { data: order, error: orderError } = await this.client
      .from("orders")
      .select("id,buyer_discord_id,guild_id,product_id,status,payment_status,paid_at,stock_released_at")
      .eq("id", input.orderId)
      .maybeSingle();
    assertQuery(orderError, "pedido cancelado");
    if (
      !order ||
      order.buyer_discord_id !== input.buyerDiscordId ||
      !["cancelled", "expired"].includes(order.status) ||
      !["cancelled", "expired"].includes(order.payment_status) ||
      order.paid_at !== null ||
      order.stock_released_at === null
    ) {
      return null;
    }

    const [{ data: guild, error: guildError }, { data: items, error: itemsError }] =
      await Promise.all([
        this.client
          .from("guilds")
          .select("discord_guild_id")
          .eq("id", order.guild_id)
          .maybeSingle(),
        this.client
          .from("order_items")
          .select("product_id,position")
          .eq("order_id", order.id)
          .order("position"),
      ]);
    assertQuery(guildError, "servidor do pedido cancelado");
    assertQuery(itemsError, "itens do pedido cancelado");
    if (guild?.discord_guild_id !== input.discordGuildId) return null;

    const productIds = [
      ...new Set(
        (items?.length ? items.map((item) => item.product_id) : [order.product_id])
          .filter((productId): productId is string => typeof productId === "string"),
      ),
    ].slice(0, 3);
    if (productIds.length === 0) return null;

    const { data: products, error: productsError } = await this.client
      .from("products")
      .select("id,name")
      .in("id", productIds);
    assertQuery(productsError, "produtos do pedido cancelado");
    const productNames = new Map(
      (products ?? []).map((product) => [product.id, product.name]),
    );

    const selections: DiscordCartSelection[] = productIds.flatMap((productId) => {
      const productName = productNames.get(productId);
      return productName ? [{ productId, productName }] : [];
    });
    return selections.length === productIds.length ? selections : null;
  }
}

function readRecoveryDm(channelId: string | null, messageId: string | null) {
  return channelId && messageId ? { channelId, messageId } : null;
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function assertQuery(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) throw new Error(`Falha no ${operation}.`);
}
