import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const payment = vi.hoisted(() => ({ createPayment: vi.fn() }));
vi.mock("@/lib/payments/client", () => ({ getPaymentClient: () => payment }));

import { RobuxPaymentService, robuxPaymentReturnUrl } from "./payment-service";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gwstore.vercel.app");
});
afterEach(() => vi.unstubAllEnvs());

describe("Robux payment return URL", () => {
  it("preserves the payment page on the configured legacy domain", () => {
    expect(robuxPaymentReturnUrl("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "https://gwstore.vercel.app/pagamento/550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it.each(["https://gwstoreofc.com", "https://www.gwstoreofc.com", "https://gwstore-production.up.railway.app"])(
    "returns Robux buyers to the configured shop at %s",
    (origin) => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);

      expect(robuxPaymentReturnUrl("550e8400-e29b-41d4-a716-446655440000"))
        .toBe(`${origin}/pagamento/550e8400-e29b-41d4-a716-446655440000`);
    },
  );

  it("reuses an issued legacy checkout after changing the canonical URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.gwstoreofc.com");
    const orderId = "550e8400-e29b-41d4-a716-446655440000";
    const checkoutUrl = `https://gwstore.vercel.app/pagamento/pix/${"a".repeat(64)}`;
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_robux_livepix_order") {
        return { data: { order_id: orderId, amount_cents: 3600 }, error: null };
      }
      if (name === "claim_robux_livepix_checkout") {
        return {
          data: { claimed: false, provider_reference: "existing-reference", checkout_url: checkoutUrl },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    const result = await new RobuxPaymentService({ rpc }).createCheckout({
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
      discordInteractionId: "323456789012345678",
      robuxQuantity: 1000,
    });

    expect(result).toEqual({ orderId, amountCents: 3600, checkoutUrl });
    expect(payment.createPayment).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("refuses malformed order identifiers", () => {
    expect(() => robuxPaymentReturnUrl("not-an-order")).toThrow("ID de pedido de Robux inválido.");
  });
});
