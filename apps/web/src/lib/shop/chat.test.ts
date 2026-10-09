import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopActor } from "./types";
import type { ShopClient } from "./repository";
const mocks = vi.hoisted(() => ({ readOrder: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./repository", () => ({ readShopOrder: mocks.readOrder, requireShopClient: vi.fn() }));
import { completeShopDelivery, readShopMessages, sendShopMessage, shopMessageSchema } from "./chat";
const actor: ShopActor = { authUserId: "auth-buyer", discordId: "423456789012345678", displayName: "Cliente", isAdmin: false };
const id = "750e8400-e29b-41d4-a716-446655440000";
const requestId = "550e8400-e29b-41d4-a716-446655440000";
function client() {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: { id: requestId, order_id: id, body: "Minha mensagem", author_role: "buyer", author_name: "Cliente", created_at: "2026-10-09T12:00:00Z", author_auth_user_id: "private" }, error: null })),
    limit: vi.fn(async () => ({ data: [], error: null })) };
  const rpc = vi.fn(async () => ({ data: requestId, error: null as null | { code: string } }));
  return { query, rpc, db: { from: vi.fn(() => query), rpc } as unknown as ShopClient };
}
beforeEach(() => { vi.clearAllMocks(); mocks.readOrder.mockResolvedValue({ orderId: id, deliveredAt: null }); });
describe("chat privado por pedido", () => {
  it.each([{ requestId, body: "" }, { requestId, body: " ", authorRole: "staff" }, { requestId, body: "x".repeat(2001) },
    { requestId, body: "controle\u0007" }, { requestId: "not-uuid", body: "Olá" } ])("rejeita mensagem inválida ou tentativa de forjar função (%j)", value => {
    expect(shopMessageSchema.safeParse(value).success).toBe(false);
  });
  it("aceita texto normal com múltiplas linhas, sem aceitar papéis/IDs de autor", () => {
    expect(shopMessageSchema.parse({ requestId, body: "  Olá\nNick: Player_123  " }).body).toBe("Olá\nNick: Player_123");
    expect(shopMessageSchema.safeParse({ requestId, body: "Olá", author_auth_user_id: "alguém" }).success).toBe(false);
  });
  it("interrompe a leitura e envio antes de tocar mensagens se outro comprador pedir o chat", async () => {
    const c = client(); mocks.readOrder.mockRejectedValue(new Error("Não pertence"));
    await expect(readShopMessages(id, actor, c.db)).rejects.toThrow("Não pertence");
    await expect(sendShopMessage(id, { requestId, body: "Mensagem" }, actor, c.db)).rejects.toThrow("Não pertence");
    expect(c.rpc).not.toHaveBeenCalled();
    expect(c.query.select).not.toHaveBeenCalled();
  });
  it("envia identidade da sessão e UUID ao RPC sem permitir autor vindo do cliente", async () => {
    const c = client();
    expect(await sendShopMessage(id, { requestId, body: "Minha mensagem" }, actor, c.db)).toEqual({
      id: requestId, body: "Minha mensagem", authorRole: "buyer", authorName: "Cliente", createdAt: "2026-10-09T12:00:00Z",
    });
    expect(c.rpc).toHaveBeenCalledWith("send_gwstore_web_order_message", { p_order_id: id, p_request_id: requestId,
      p_actor_auth_user_id: actor.authUserId, p_actor_discord_id: actor.discordId, p_author_name: "Cliente", p_body: "Minha mensagem" });
    expect(c.query.eq).toHaveBeenCalledWith("order_id", id);
    expect(c.query.eq).toHaveBeenCalledWith("id", requestId);
  });
  it.each([["P0008", "rate_limited"], ["22000", "request_conflict"], ["42501", "forbidden"], ["XX000", "unavailable"]])("sanitiza erro RPC %s", async (code, expected) => {
    const c = client(); c.rpc.mockResolvedValue({ data: requestId, error: { code } });
    await expect(sendShopMessage(id, { requestId, body: "Olá" }, actor, c.db)).rejects.toMatchObject({ code: expected });
  });
  it("proíbe comprador de marcar entrega sem chamada DB", async () => {
    const c = client();
    await expect(completeShopDelivery(id, actor, c.db)).rejects.toMatchObject({ code: "forbidden" });
    expect(mocks.readOrder).not.toHaveBeenCalled(); expect(c.rpc).not.toHaveBeenCalled();
  });
  it("admin usa RPC que valida pagamento/estoque e retorna status persistido", async () => {
    const c = client(); mocks.readOrder.mockResolvedValueOnce({ orderId: id }).mockResolvedValueOnce({ orderId: id, status: "delivered" });
    expect(await completeShopDelivery(id, { ...actor, isAdmin: true }, c.db)).toEqual({ orderId: id, status: "delivered" });
    expect(c.rpc).toHaveBeenCalledWith("complete_gwstore_web_order_delivery", { p_order_id: id,
      p_actor_auth_user_id: actor.authUserId, p_actor_discord_id: actor.discordId });
  });
});
