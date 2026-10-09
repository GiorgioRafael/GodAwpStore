import "server-only";
import { GW_UP_GUILD_ID } from "@/lib/bot/gw-up-catalog";
import { IS_GWSTORE } from "@/lib/brand";
import { requireShopClient, type ShopClient } from "./repository";
type RpcClient = { rpc(name: string, input: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

/** Read persisted origin before any Discord side effect. Unknown origin fails closed. */
export async function fulfillWebOrderIfApplicable(orderId: string, configuredClient?: ShopClient): Promise<boolean> {
  if (!IS_GWSTORE) return false;
  const client = configuredClient ?? requireShopClient();
  const { data, error } = await client.from("orders").select("payment_reference,guilds!inner(discord_guild_id)").eq("id", orderId).maybeSingle();
  if (error || !data) throw new Error("Não foi possível identificar a entrega do pedido.");
  if (!data.payment_reference?.startsWith("web:")) return false;
  if (data.guilds.discord_guild_id !== GW_UP_GUILD_ID) throw new Error("Origem inválida de pedido da loja.");
  const result = await (client as unknown as RpcClient).rpc("ensure_gwstore_web_order_chat", { p_order_id: orderId });
  if (result.error || result.data !== true) throw new Error("Não foi possível preparar o atendimento privado.");
  return true;
}
