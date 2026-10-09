import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  publishRoulettePromotion: vi.fn(),
  openRouletteRedemptionTicket: vi.fn(),
  syncRouletteRedemptionTicketControls: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.createAdminSupabaseClient }));
vi.mock("@/lib/env", () => ({ getSiteUrl: () => "https://thstore.example" }));
vi.mock("@/lib/roulette/promotion", () => ({ publishRoulettePromotion: mocks.publishRoulettePromotion }));
vi.mock("@/lib/roulette/redemptions", () => ({
  openRouletteRedemptionTicket: mocks.openRouletteRedemptionTicket,
  syncRouletteRedemptionTicketControls: mocks.syncRouletteRedemptionTicketControls,
}));

const EMPTY = { ok: false, message: "" };
const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";

function form(values: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

async function newActions(storeName: string) {
  vi.stubEnv("NEXT_PUBLIC_STORE_NAME", storeName);
  vi.resetModules();
  return {
    ...await import("./roulette-wheel"),
    ...await import("./roulette-metrics"),
    ...await import("./roulette-promotion"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ authUserId: "admin" });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  const query = {
    eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn(), select: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: { id: 1, discord_guild_id: "guild", roulette_promotion_channel_id: "channel", roulette_promotion_message_id: "message" },
      error: null,
    })),
  };
  for (const method of [query.eq, query.is, query.order, query.limit, query.select]) method.mockReturnValue(query);
  mocks.update.mockReturnValue(query);
  mocks.from.mockReturnValue({ ...query, update: mocks.update });
  mocks.createServerSupabaseClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
  mocks.createAdminSupabaseClient.mockReturnValue({ from: mocks.from });
  mocks.publishRoulettePromotion.mockResolvedValue({ channelId: "channel", messageId: "message" });
  mocks.openRouletteRedemptionTicket.mockResolvedValue({ channelId: "ticket" });
  mocks.syncRouletteRedemptionTicketControls.mockResolvedValue({ synchronized: true });
});

afterEach(() => vi.unstubAllEnvs());

describe("operações administrativas de roleta por loja", () => {
  it.each(["GWStore", "GodAwp Store"])("recusa novas configurações e divulgação em %s antes de acessar banco ou Discord", async storeName => {
    const actions = await newActions(storeName);
    for (const action of [actions.saveRouletteWheelAction, actions.toggleRouletteAction,
      actions.saveRouletteRatesAction, actions.saveRoulettePromotionAction]) {
      await expect(action(EMPTY, new FormData())).resolves.toEqual({
        ok: false, message: "A roleta não está disponível nesta loja.",
      });
    }
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.publishRoulettePromotion).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserva salvar roda, ativação, taxas e publicação na THStore", async () => {
    const actions = await newActions("THStore");
    const results = [
      await actions.saveRouletteWheelAction(EMPTY, form({ "product-premio_1": PRODUCT_ID, "weight-premio_1": "2", "quantity-premio_1": "1" })),
      await actions.toggleRouletteAction(EMPTY, form({ enabled: "on" })),
      await actions.saveRouletteRatesAction(EMPTY, form({ markupPercent: "70", feePercent: "5", salePercent: "50" })),
      await actions.saveRoulettePromotionAction(EMPTY, form({ title: "Roleta TH", description: "Escolha seus prêmios", buttonLabel: "Jogar", bannerUrl: "https://thstore.example/banner.png" })),
    ];
    expect(results.every(result => result.ok)).toBe(true);
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(4);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_save_roulette_wheel", {
      p_slots: [{ prize_key: "premio_1", product_id: PRODUCT_ID, draw_weight: 2, prize_quantity: 1 }],
    });
    expect(mocks.update).toHaveBeenCalledWith({ roulette_enabled: true });
    expect(mocks.update).toHaveBeenCalledWith({ roulette_markup_bps: 7_000, livepix_fee_bps: 500, roulette_sale_rate_bps: 5_000 });
    expect(mocks.publishRoulettePromotion).toHaveBeenCalledOnce();
  });

  it("mantém conclusão e reparo de tickets dos prêmios antigos da GWStore", async () => {
    await newActions("GWStore");
    const actions = await import("./roulette-redemptions");
    const record = form({ redemptionId: PRODUCT_ID, status: "delivered" });
    const results = [
      await actions.settleRouletteRedemptionAction(EMPTY, record),
      await actions.retryRouletteRedemptionTicketAction(EMPTY, record),
      await actions.syncRouletteRedemptionControlsAction(EMPTY, record),
    ];
    expect(results.every(result => result.ok)).toBe(true);
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(3);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_settle_roulette_redemption", {
      p_redemption_id: PRODUCT_ID, p_status: "delivered",
    });
    expect(mocks.openRouletteRedemptionTicket).toHaveBeenCalledWith(PRODUCT_ID);
    expect(mocks.syncRouletteRedemptionTicketControls).toHaveBeenCalledWith(PRODUCT_ID);
  });
});
