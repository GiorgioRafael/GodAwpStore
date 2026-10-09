import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminSession: vi.fn(), createServerClient: vi.fn(), createAdminClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand", () => ({ STORE_SLUG: "gwstore", STORE_NAME: "GWStore", STORE_CATALOG_LABEL: "Blox Fruits" }));
vi.mock("@/lib/auth", () => ({ getAdminSession: mocks.getAdminSession }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.createAdminClient }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/roulette/roulette-experience", () => ({ RouletteExperience: () => null }));
vi.mock("@/components/roulette/roulette-header", () => ({ RouletteHeader: () => null }));
vi.mock("@/components/roulette/roulette-overlay", () => ({ RouletteOverlay: () => null }));
vi.mock("@/lib/livepix/payment-service", () => ({ reconciliationDigest: async () => "verified-digest" }));

import RoulettePage from "@/app/roleta/page";
import RouletteOverlayPage from "@/app/roleta/overlay/page";
import { readRouletteOverlayEvents } from "@/app/roleta/overlay/actions";
import { RouletteCoinPurchaseService, type RouletteCoinPurchaseRepository } from "./coin-purchase";
import { publishRoulettePromotion } from "./promotion";
import { getRouletteOverlayLink } from "./overlay-link";

const PURCHASE_ID = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const payment = { id: "old-payment", proof: "old-proof", reference: "old-reference", amountCents: 300, currency: "BRL", createdAt: "2026-07-27T12:00:00.000Z" };

beforeEach(() => vi.clearAllMocks());

describe("closed GW roulette", () => {
  it("returns not found for both public pages before auth or DB access", async () => {
    const props = { searchParams: Promise.resolve({ token: "even-a-valid-token" }) };
    await expect(RoulettePage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(RouletteOverlayPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not expose overlay links or events, or publish more promotion messages", async () => {
    const fetcher = vi.fn();
    await expect(getRouletteOverlayLink()).resolves.toEqual({ status: "forbidden" });
    await expect(readRouletteOverlayEvents("old-token", null)).resolves.toMatchObject({ events: [] });
    await expect(publishRoulettePromotion({ guildId: "1401264061101899820", title: "Title", description: "Copy", buttonLabel: "Spin" }, { fetcher }))
      .rejects.toThrow("A roleta não está disponível nesta loja.");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.getAdminSession).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("blocks checkout creation at the service while still confirming an existing paid checkout", async () => {
    const checkout = { purchaseId: PURCHASE_ID, providerReference: payment.reference, checkoutUrl: "https://checkout.livepix.gg/old" };
    const credit = { purchaseId: PURCHASE_ID, status: "credited" as const, creditedAmountCents: 300, coinBalanceCents: 300, firstConfirmation: true };
    const repository: RouletteCoinPurchaseRepository = {
      findCheckoutByReference: vi.fn(async () => checkout),
      findCheckoutByPurchase: vi.fn(async () => checkout),
      claimCheckout: vi.fn(), registerCheckout: vi.fn(), releaseCheckoutClaim: vi.fn(),
      claimProviderCheck: vi.fn(async () => true), creditPurchase: vi.fn(async () => credit),
    };
    const client = { createPayment: vi.fn(), getPaymentByReference: vi.fn(async () => payment) };
    const service = new RouletteCoinPurchaseService(repository, client);
    await expect(service.createCheckout(PURCHASE_ID, "https://gwstoreofc.com"))
      .rejects.toThrow("A roleta não está disponível nesta loja.");
    expect(repository.claimCheckout).not.toHaveBeenCalled();
    expect(client.createPayment).not.toHaveBeenCalled();
    await expect(service.reconcilePayment({ providerPaymentId: payment.id, providerReference: payment.reference })).resolves.toEqual(credit);
    await expect(service.pullPendingPayment(PURCHASE_ID)).resolves.toEqual(credit);
  });
});
