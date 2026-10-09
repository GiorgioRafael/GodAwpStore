import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(),
  getAdminSession: vi.fn(), createAdminClient: vi.fn(),
  createCheckout: vi.fn(), pullPendingPayment: vi.fn(), openTicket: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAdminSession: mocks.getAdminSession }));
vi.mock("@/lib/auth-identity", () => ({
  extractDiscordIdentity: () => ({
    authUserId: "e0cad6b4-c23d-44f1-a9cf-d8f0c0f5aa19",
    discordId: "123456789012345678", displayName: "Player",
  }),
}));
vi.mock("@/lib/env", () => ({ getSiteUrl: () => "https://thstoreadm.vercel.app" }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.createAdminClient }));
vi.mock("@/lib/roulette/runtime", () => ({
  getRouletteCoinPurchaseService: () => ({
    createCheckout: mocks.createCheckout, pullPendingPayment: mocks.pullPendingPayment,
  }),
}));
vi.mock("@/lib/roulette/redemptions", () => ({ openRouletteRedemptionTicket: mocks.openTicket }));

const PURCHASE_ID = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const PRODUCT_ID = "2bff2ad8-daf2-46cd-905b-c84f98b0dff4";
const selection = [{ prizeKey: "premio_1" as const, productId: PRODUCT_ID, unitValueCents: 100, quantity: 1 }];

async function actions(storeSlug: string) {
  vi.resetModules();
  vi.doMock("@/lib/brand", () => ({ STORE_SLUG: storeSlug }));
  return import("./actions");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "player" } }, error: null });
  mocks.getAdminSession.mockResolvedValue({ status: "unauthorized" });
  mocks.openTicket.mockResolvedValue({ channelId: "123456789012345678" });
});

describe("roulette public actions by store", () => {
  it.each(["gwstore", "godawp-store"])("blocks new purchases, admin/free spins and resale before DB access on %s", async (store) => {
    const api = await actions(store);
    mocks.getAdminSession.mockResolvedValue({ status: "authorized" });
    for (const result of [
      await api.startRouletteCoinPurchase(3), await api.spinRoulette(), await api.sellRoulettePrizes(selection),
    ]) expect(result).toEqual({ ok: false, message: "A roleta não está disponível nesta loja." });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("still reconciles an existing GW payment without creating another charge", async () => {
    const api = await actions("gwstore");
    mocks.rpc.mockResolvedValue({ data: [{ purchase_id: PURCHASE_ID, purchase_status: "awaiting_payment" }], error: null });
    mocks.pullPendingPayment.mockResolvedValue({ purchaseId: PURCHASE_ID, status: "credited", coinBalanceCents: 300 });
    await expect(api.getRouletteCoinPurchaseStatus(PURCHASE_ID)).resolves.toEqual({
      ok: true, purchaseId: PURCHASE_ID, status: "credited", balanceCents: 300,
    });
    expect(mocks.pullPendingPayment).toHaveBeenCalledWith(PURCHASE_ID);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("still redeems a GW prize already held and opens its delivery ticket", async () => {
    const api = await actions("gwstore");
    mocks.rpc.mockResolvedValue({ data: [{
      created_redemption_id: PURCHASE_ID, redeemed_item_count: 1,
      redeemed_items: [{ prize_key: "premio_1", product_id: PRODUCT_ID, unit_value_cents: 100, remaining_quantity: 0, product_name: "Prize", quantity: 1 }],
    }], error: null });
    await expect(api.redeemRoulettePrizes(selection)).resolves.toMatchObject({ ok: true, ticketOpened: true, itemCount: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("redeem_roulette_prizes", { p_items: [{
      prize_key: "premio_1", product_id: PRODUCT_ID, unit_value_cents: 100, quantity: 1,
    }] });
    expect(mocks.openTicket).toHaveBeenCalledWith(PURCHASE_ID);
  });

  it("requires the player's session even for legacy GW settlement", async () => {
    const api = await actions("gwstore");
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(api.redeemRoulettePrizes(selection)).resolves.toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps TH coin purchases and regular spins working", async () => {
    const api = await actions("thstore");
    mocks.rpc.mockResolvedValueOnce({ data: [{ purchase_id: PURCHASE_ID, purchase_status: "awaiting_payment", purchase_amount_cents: 300 }], error: null });
    mocks.createCheckout.mockResolvedValue({ checkoutUrl: "https://checkout.livepix.gg/th-purchase" });
    await expect(api.startRouletteCoinPurchase(3)).resolves.toMatchObject({ ok: true, amountCents: 300 });
    mocks.rpc.mockResolvedValueOnce({ data: [{
      recorded_spin_id: PURCHASE_ID, won_prize_key: "premio_1", won_product_id: PRODUCT_ID,
      won_unit_value_cents: 100, won_unit_sale_value_cents: 50, won_inventory_quantity: 1, coin_balance_cents: 200,
    }], error: null });
    await expect(api.spinRoulette()).resolves.toMatchObject({ ok: true, productId: PRODUCT_ID, balanceCents: 200 });
    expect(mocks.rpc).toHaveBeenCalledWith("spin_roulette", { p_discord_user_id: "123456789012345678", p_display_name: "Player" });
  });
});
