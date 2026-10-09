import "server-only";
import { z } from "zod";
import { ShopError } from "./errors";
import { readShopOrder, requireShopClient, type ShopClient } from "./repository";
import type { ShopActor, ShopMessage } from "./types";

export const shopMessageSchema = z.object({
  requestId: z.uuid().transform(value => value.toLowerCase()),
  body: z.string().trim().min(1).max(2000).refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)),
}).strict();
const MESSAGE_SELECT = "id,body,author_role,author_name,created_at";
type MessageRow = { id: string; body: string; author_role: "buyer" | "staff" | "system"; author_name: string; created_at: string };
type RpcClient = { rpc(name: string, input: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }> };

export async function readShopMessages(orderId: string, actor: ShopActor, client = requireShopClient()) {
  const order = await readShopOrder(orderId, actor, client);
  const { data: chat, error: chatError } = await client.from("web_order_chats").select("order_id").eq("order_id", orderId).maybeSingle();
  if (chatError) throw new ShopError("unavailable");
  if (!chat) return { messages: [] as ShopMessage[], canSend: false, deliveredAt: order.deliveredAt };
  const { data, error } = await client.from("web_order_messages").select(MESSAGE_SELECT)
    .eq("order_id", orderId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);
  if (error) throw new ShopError("unavailable");
  return { messages: (data ?? []).reverse().map(messageDto), canSend: true, deliveredAt: order.deliveredAt };
}

export async function sendShopMessage(orderId: string, raw: unknown, actor: ShopActor, client = requireShopClient()) {
  const parsed = shopMessageSchema.safeParse(raw);
  if (!parsed.success) throw new ShopError("invalid_request");
  // Every service-role read has its ownership check before touching chat rows.
  await readShopOrder(orderId, actor, client);
  const { data, error } = await (client as unknown as RpcClient).rpc("send_gwstore_web_order_message", {
    p_order_id: orderId, p_request_id: parsed.data.requestId,
    p_actor_auth_user_id: actor.authUserId, p_actor_discord_id: actor.discordId,
    p_author_name: actor.displayName.slice(0, 80), p_body: parsed.data.body,
  });
  if (error) throw rpcError(error.code);
  if (typeof data !== "string") throw new ShopError("unavailable");
  return readMessage(client, orderId, data);
}

export async function completeShopDelivery(orderId: string, actor: ShopActor, client = requireShopClient()) {
  if (!actor.isAdmin) throw new ShopError("forbidden");
  await readShopOrder(orderId, actor, client);
  const { error } = await (client as unknown as RpcClient).rpc("complete_gwstore_web_order_delivery", {
    p_order_id: orderId, p_actor_auth_user_id: actor.authUserId, p_actor_discord_id: actor.discordId,
  });
  if (error) throw rpcError(error.code);
  return readShopOrder(orderId, actor, client);
}

async function readMessage(client: ShopClient, orderId: string, messageId: string): Promise<ShopMessage> {
  const { data, error } = await client.from("web_order_messages").select(MESSAGE_SELECT)
    .eq("order_id", orderId).eq("id", messageId).maybeSingle();
  if (error || !data) throw new ShopError("unavailable");
  return messageDto(data);
}
function messageDto(row: MessageRow): ShopMessage {
  return { id: row.id, body: row.body, authorRole: row.author_role, authorName: row.author_name, createdAt: row.created_at };
}
function rpcError(code?: string) {
  return new ShopError(code === "P0002" ? "not_found" : code === "42501" ? "forbidden"
    : code === "22000" ? "request_conflict" : code === "P0008" ? "rate_limited"
    : code === "P0009" ? "delivery_not_allowed" : code === "22023" ? "invalid_request" : "unavailable");
}
