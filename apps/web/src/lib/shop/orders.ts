import "server-only";
import { GW_UP_GUILD_ID } from "@/lib/bot/gw-up-catalog";
import { ShopError } from "./errors";
import { orderDto, requireShopClient, SHOP_ORDER_SELECT, type ShopClient, type ShopOrderRow } from "./repository";
import type { ShopActor } from "./types";

export async function listShopOrders(actor: ShopActor, all = false, client: ShopClient = requireShopClient()) {
  if (all && !actor.isAdmin) throw new ShopError("forbidden");
  let query = client.from("orders").select(SHOP_ORDER_SELECT)
    .like("payment_reference", "web:%").eq("guilds.discord_guild_id", GW_UP_GUILD_ID)
    .order("created_at", { ascending: false }).order("id").limit(100);
  if (!all) query = query.eq("web_buyer_auth_user_id", actor.authUserId);
  // Active paid support has priority over recent unpaid checkouts. A burst of
  // pending invoices must not hide customers still waiting for their delivery.
  const priorityQuery = all ? client.from("orders").select(SHOP_ORDER_SELECT)
    .like("payment_reference", "web:%").eq("guilds.discord_guild_id", GW_UP_GUILD_ID)
    .eq("payment_status", "paid").is("delivered_at", null).order("paid_at").order("id").limit(100) : null;
  const [recent, priority] = await Promise.all([query, priorityQuery]);
  const { data, error } = recent;
  if (priority?.error) throw new ShopError("unavailable");
  if (error) throw new ShopError("unavailable");
  const unique = new Map<string, ShopOrderRow>();
  for (const row of [...(priority?.data ?? []), ...(data ?? [])] as unknown as ShopOrderRow[]) if (!unique.has(row.id)) unique.set(row.id, row);
  return [...unique.values()].slice(0, 100).filter(order => order.guilds?.discord_guild_id === GW_UP_GUILD_ID
    && (all || order.web_buyer_auth_user_id === actor.authUserId)).map(orderDto);
}
