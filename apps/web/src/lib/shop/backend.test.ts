import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotCommerceRepository, ExistingPurchase, PurchasableProduct } from "@/lib/bot/types";
import type { ShopActor, ShopOrderStatus } from "./types";
vi.mock("server-only", () => ({}));
const brand = vi.hoisted(() => ({ IS_GWSTORE: true }));
vi.mock("@/lib/brand", () => brand);
vi.mock("@/lib/livepix/runtime", () => ({ getLivePixPaymentService: vi.fn() }));
import { BotCommerceService } from "@/lib/bot/commerce-service";
import { GW_UP_GUILD_ID, GW_UP_STORE_ID } from "@/lib/bot/gw-up-catalog";
import { createShopCheckout } from "./checkout";
import { shopCheckoutSchema } from "./validation";
import { loadShopCatalog } from "./catalog";
import { orderDto, readShopOrder, type ShopClient, type ShopOrderRow } from "./repository";
import { fulfillWebOrderIfApplicable } from "./fulfillment";

const requestId = "550e8400-e29b-41d4-a716-446655440000";
const productId = "650e8400-e29b-41d4-a716-446655440000";
const orderId = "750e8400-e29b-41d4-a716-446655440000";
const actor: ShopActor = { authUserId: "850e8400-e29b-41d4-a716-446655440000", discordId: "423456789012345678", displayName: "Cliente", isAdmin: false };
const guild = { discordGuildId: GW_UP_GUILD_ID, ownerDiscordId: "223456789012345678", name: "GWStore" };
const raw = { requestId, items: [{ productId, quantity: 2 }], gameNickname: "Player_123" };
const status: ShopOrderStatus = { orderId, status: "awaiting_payment", paymentStatus: "pending", totalPriceCents: 321,
  checkoutUrl: null, ticketUrl: null, chatUrl: null, gameNickname: raw.gameNickname, createdAt: "2026-10-09T12:00:00Z",
  paidAt: null, deliveredAt: null, paymentExpiresAt: "2999-10-09T12:00:00Z", pixCode: null, buyerName: actor.displayName, items: [] };

function setup() {
  const repository = {
    findPurchaseByInteraction: vi.fn(async (): Promise<ExistingPurchase | null> => null),
    ensureGuild: vi.fn(async () => ({ id: "guild-row", whitelistEntryId: "seller-row", boosterDiscount: { enabled: true, discount_bps: 500, minimum_subtotal_cents: 0 } })),
    findPurchasableProducts: vi.fn(async (): Promise<PurchasableProduct[]> => [{ id: productId, name: "Produto", minimumPriceCents: 200, catalogStoreId: "normal" }]),
    countAvailableStocks: vi.fn(async () => new Map([[productId, 10]])),
    getCustomerRankProgress: vi.fn(async () => ({ guildId: "guild-row", buyerDiscordId: actor.discordId, totalSpentCents: 0, currentRank: null, nextRank: null, amountToNextRankCents: 0 })),
    getCommissionBps: vi.fn(async () => 1000),
    createAwaitingPaymentPurchase: vi.fn(async () => ({ id: orderId, status: "awaiting_payment" as const, created: true, outOfStock: false })),
  };
  const dependencies = { repository: repository as unknown as BotCommerceRepository,
    buyerContext: vi.fn(async () => ({ guild, isServerBooster: true })),
    readOrder: vi.fn(async () => status), createCheckout: vi.fn(async () => undefined) };
  return { repository, dependencies };
}
beforeEach(() => { vi.clearAllMocks(); brand.IS_GWSTORE = true; });

describe("checkout público seguro", () => {
  it.each([ { ...raw, priceCents: 1 }, { ...raw, buyerDiscordId: "123456789012345678" }, { ...raw, isServerBooster: true },
    { ...raw, items: [{ productId, quantity: NaN }] }, { ...raw, items: [{ productId, quantity: 1.5 }] },
    { ...raw, items: [{ productId, quantity: 0 }] }, { ...raw, items: [{ productId, quantity: 10001 }] },
    { ...raw, items: [raw.items[0], raw.items[0]] }, { ...raw, gameNickname: "../../senha" } ])("rejeita parâmetros não autorizados ou inválidos (%j)", value => {
    expect(shopCheckoutSchema.safeParse(value).success).toBe(false);
  });
  it("usa preço/conta no servidor, ignora booster e retorna o valor persistido antes e depois da emissão", async () => {
    const { repository, dependencies } = setup();
    const result = await createShopCheckout(raw, actor, dependencies);
    expect(result.totalPriceCents).toBe(321);
    expect(repository.createAwaitingPaymentPurchase).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: requestId, buyerDiscordId: actor.discordId, items: raw.items, discountBps: 0, discountReason: null,
    }));
    expect(dependencies.readOrder).toHaveBeenCalledTimes(2);
    expect(dependencies.readOrder.mock.invocationCallOrder[0]).toBeLessThan(dependencies.createCheckout.mock.invocationCallOrder[0]);
    expect(dependencies.createCheckout).toHaveBeenCalledOnce();
  });
  it("não muda a aceitação de IDs dos pedidos Discord", async () => {
    const { dependencies } = setup();
    expect(await new BotCommerceService(dependencies.repository).purchaseCart({ interactionId: requestId, buyerDiscordId: actor.discordId,
      items: raw.items, guild, isServerBooster: false })).toEqual({ kind: "invalid_request" });
  });
  it("retorna o mesmo pedido pago mesmo depois de produto pausado, sem outra cobrança", async () => {
    const { repository, dependencies } = setup();
    repository.findPurchaseByInteraction.mockResolvedValue({ id: orderId, buyerDiscordId: actor.discordId, guildId: "guild-row",
      items: [{ productId, productName: "Produto", quantity: 2, unitPriceCents: 200, subtotalPriceCents: 400, totalPriceCents: 400, discountAmountCents: 0 }],
      subtotalPriceCents: 400, salePriceCents: 400, discountBps: 0, discountAmountCents: 0, discountReason: null,
      upsellProductId: null, upsellDiscountBps: 0, upsellDiscountAmountCents: 0, leadRecoveryDiscountBps: 0, leadRecoveryDiscountAmountCents: 0, status: "paid" });
    repository.findPurchasableProducts.mockResolvedValue([]);
    dependencies.readOrder.mockResolvedValue({ ...status, status: "paid", paymentStatus: "paid", paidAt: "2026-10-09T12:00:00Z" });
    expect((await createShopCheckout(raw, actor, dependencies)).paymentStatus).toBe("paid");
    // The shared commerce service may read availability in parallel, but an
    // existing paid request does not depend on a product still being active.
    expect(repository.createAwaitingPaymentPurchase).not.toHaveBeenCalled();
    expect(dependencies.createCheckout).not.toHaveBeenCalled();
  });
  it("exige confirmação para UP e mantém estoque ilimitado", async () => {
    const { repository, dependencies } = setup();
    repository.findPurchasableProducts.mockResolvedValue([{ id: productId, name: "Level", minimumPriceCents: 200, catalogStoreId: GW_UP_STORE_ID, unlimitedStock: true }]);
    repository.countAvailableStocks.mockResolvedValue(new Map([[productId, 0]]));
    await expect(createShopCheckout(raw, actor, dependencies)).rejects.toMatchObject({ code: "requirements_required" });
    await expect(createShopCheckout({ ...raw, serviceRequirementsConfirmed: true }, actor, dependencies)).resolves.toMatchObject({ orderId });
  });
  it("preserva pedido se o gateway falhar e retorna só erro seguro", async () => {
    const { dependencies } = setup();
    dependencies.createCheckout.mockRejectedValue(new Error("segredo upstream"));
    await expect(createShopCheckout(raw, actor, dependencies)).rejects.toMatchObject({ code: "checkout_pending" });
  });
  it("rejeita outra guild antes da criação ou pagamento", async () => {
    const { repository, dependencies } = setup();
    dependencies.buyerContext.mockResolvedValue({ guild: { ...guild, discordGuildId: "999999999999999999" }, isServerBooster: false });
    await expect(createShopCheckout(raw, actor, dependencies)).rejects.toMatchObject({ code: "forbidden" });
    expect(repository.createAwaitingPaymentPurchase).not.toHaveBeenCalled();
  });
});

describe("catálogo e atendimento persistido", () => {
  it("não consulta nem ativa atendimento web na THStore", async () => {
    brand.IS_GWSTORE = false;
    const from = vi.fn(() => { throw new Error("Não deve acessar o banco"); });
    expect(await fulfillWebOrderIfApplicable(orderId, { from } as unknown as ShopClient)).toBe(false);
    expect(from).not.toHaveBeenCalled();
    await expect(createShopCheckout(raw, actor, setup().dependencies)).rejects.toMatchObject({ code: "not_found" });
  });
  it("projeta serviços, requisitos e estoque sem aceitar preço inválido", async () => {
    const result = await loadShopCatalog({ listCatalog: vi.fn(async () => [{ id: "game", name: "Blox", catalogStoreId: GW_UP_STORE_ID,
      substores: [{ id: "sub", name: "UP", title: "UP", description: "", imageUrl: null, colorHex: "#FFFFFF", products: [
        { id: productId, name: "Level", description: "Requer nick", priceCents: 200, unlimitedStock: true, availableStock: 0, sortOrder: 0 },
        { id: "invalid", name: "Inválido", description: null, priceCents: NaN, availableStock: 1, sortOrder: 1 },
      ] }] }] ) });
    expect(result[0].substores[0].products).toHaveLength(1);
    expect(result[0].substores[0].products[0]).toMatchObject({ isUpService: true, serviceRequirements: ["Requer nick"], unlimitedStock: true });
  });
  it("esconde Pix pago/expirado e mantém atendimento inclusive para pagamento atrasado", () => {
    const row = { id: orderId, status: "cancelled", payment_status: "paid", sale_price_cents: 500, payment_checkout_url: "https://pix.example",
      payment_provider_reference: null, payment_expires_at: "2020-01-01T00:00:00Z", game_nickname: "Player", created_at: "2026-10-09T12:00:00Z", paid_at: "2026-10-09T12:01:00Z",
      delivered_at: null, buyer_discord_id: actor.discordId, web_buyer_auth_user_id: actor.authUserId, web_buyer_name: "Cliente", web_items_snapshot: [], guilds: { discord_guild_id: GW_UP_GUILD_ID } } satisfies ShopOrderRow;
    expect(orderDto(row)).toMatchObject({ checkoutUrl: null, pixCode: null, ticketUrl: null, chatUrl: `/minhas-compras/${orderId}` });
  });
  it("verifica autor auth e Discord antes de mostrar dados/Pix", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), like: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: null, error: null })) };
    const client = { from: vi.fn(() => query) } as unknown as ShopClient;
    await expect(readShopOrder(orderId, actor, client)).rejects.toMatchObject({ code: "not_found" });
    expect(query.eq).toHaveBeenCalledWith("web_buyer_auth_user_id", actor.authUserId);
    expect(query.eq).toHaveBeenCalledWith("buyer_discord_id", actor.discordId);
    expect(query.eq).toHaveBeenCalledWith("guilds.discord_guild_id", GW_UP_GUILD_ID);
  });
  it("envia web pago ao chat, bot segue ao Discord; origem desconhecida falha fechada", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: { payment_reference: `web:${requestId}`, guilds: { discord_guild_id: GW_UP_GUILD_ID } }, error: null as unknown })) };
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const client = { from: vi.fn(() => query), rpc } as unknown as ShopClient;
    expect(await fulfillWebOrderIfApplicable(orderId, client)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ensure_gwstore_web_order_chat", { p_order_id: orderId });
    query.maybeSingle.mockResolvedValue({ data: { payment_reference: "discord:123456789012345678", guilds: { discord_guild_id: GW_UP_GUILD_ID } }, error: null });
    expect(await fulfillWebOrderIfApplicable(orderId, client)).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    query.maybeSingle.mockResolvedValue({ data: null as never, error: new Error("DB") });
    await expect(fulfillWebOrderIfApplicable(orderId, client)).rejects.toThrow("identificar");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
