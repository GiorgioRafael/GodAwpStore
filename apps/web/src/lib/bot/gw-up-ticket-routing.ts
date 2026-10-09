import "server-only";

import { IS_GWSTORE } from "@/lib/brand";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { GW_UP_CATEGORIES, GW_UP_GUILD_ID, GW_UP_STORE_ID } from "./gw-up-catalog";

export type GwStoreOrderTicketKind = "purchase" | "up";

const ORDER_BATCH_SIZE = 100;
const ITEM_PAGE_SIZE = 500;
const UP_PRODUCT_IDS = new Set(
  GW_UP_CATEGORIES.flatMap(category => category.services.map(service => service.id)),
);

/** Uses the complete order, so a mixed cart continues to belong to Compra. */
export async function loadGwStoreOrderTicketKinds(
  guildId: string,
  orderIds: readonly string[],
): Promise<Map<string, GwStoreOrderTicketKind>> {
  const ids = [...new Set(orderIds.map(id => id.toLowerCase()))];
  const kinds = new Map<string, GwStoreOrderTicketKind>(ids.map(id => [id, "purchase"]));
  if (!IS_GWSTORE || guildId !== GW_UP_GUILD_ID || ids.length === 0) return kinds;

  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase não configurado para classificar tickets de UP.");

  for (let start = 0; start < ids.length; start += ORDER_BATCH_SIZE) {
    const batchIds = ids.slice(start, start + ORDER_BATCH_SIZE);
    const { data: orders, error: orderError } = await client
      .from("orders")
      .select("id,product_id,guilds!inner(discord_guild_id),product:products!orders_product_id_fkey(catalog_store_id)")
      .eq("guilds.discord_guild_id", guildId)
      .in("id", batchIds)
      .range(0, batchIds.length - 1);
    if (orderError) {
      throw new Error(`Falha ao classificar pedidos de UP: ${orderError.message}`);
    }

    // A service-role client bypasses RLS: check the returned guild as well as the query filter.
    const scopedOrders = (orders ?? []).filter(order => order.guilds?.discord_guild_id === guildId);
    if (scopedOrders.length === 0) continue;
    const scopedIds = scopedOrders.map(order => order.id);
    const itemKinds = new Map<string, { count: number; allUp: boolean }>();

    for (let offset = 0; ; offset += ITEM_PAGE_SIZE) {
      const { data: items, error: itemError } = await client
        .from("order_items")
        .select("order_id,product_id,product:products!order_items_product_id_fkey(catalog_store_id)")
        .in("order_id", scopedIds)
        .order("order_id", { ascending: true })
        .order("position", { ascending: true })
        .range(offset, offset + ITEM_PAGE_SIZE - 1);
      if (itemError) {
        throw new Error(`Falha ao classificar itens de UP: ${itemError.message}`);
      }
      for (const item of items ?? []) {
        const previous = itemKinds.get(item.order_id) ?? { count: 0, allUp: true };
        itemKinds.set(item.order_id, {
          count: previous.count + 1,
          allUp: previous.allUp && isUpProduct(item.product_id, item.product?.catalog_store_id),
        });
      }
      if ((items?.length ?? 0) < ITEM_PAGE_SIZE) break;
    }

    for (const order of scopedOrders) {
      const lines = itemKinds.get(order.id);
      // Legacy single-item orders predate order_items. Never use this fallback for a mixed cart.
      const allUp = lines?.count
        ? lines.allUp
        : isUpProduct(order.product_id, order.product?.catalog_store_id);
      if (allUp) kinds.set(order.id, "up");
    }
  }
  return kinds;
}

export async function resolveGwStoreOrderTicketKind(
  guildId: string,
  orderId: string,
): Promise<GwStoreOrderTicketKind> {
  const kinds = await loadGwStoreOrderTicketKinds(guildId, [orderId]);
  return kinds.get(orderId.toLowerCase()) ?? "purchase";
}

function isUpProduct(productId: string, catalogStoreId: string | null | undefined) {
  return catalogStoreId === GW_UP_STORE_ID || UP_PRODUCT_IDS.has(productId);
}
