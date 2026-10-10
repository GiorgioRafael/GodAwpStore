import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseLivePixPaymentRepository } from "./supabase-repository";

const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const buyerId = "223456789012345678";

function repository(data: Record<string, unknown>) {
  const rpc = vi.fn(() => ({ single: vi.fn(async () => ({ data, error: null })) }));
  return { rpc, repository: new SupabaseLivePixPaymentRepository({ rpc } as never) };
}

describe("SupabaseLivePixPaymentRepository compradores opcionais", () => {
  it("mantém Discord nulo na confirmação financeira da compra web", async () => {
    const { repository: payments } = repository({
      processed_order_id: orderId, discord_guild_id: "123456789012345678", buyer_discord_id: null,
      product_name: "Produto", paid_amount_cents: 500, resulting_order_status: "paid", first_confirmation: true,
      existing_ticket_channel_id: null, ticket_status: "not_applicable",
    });
    await expect(payments.confirmPayment({ providerPaymentId: "provider-payment", providerProof: "proof",
      providerReference: "provider-reference", amountCents: 500, currency: "BRL",
      providerCreatedAt: "2026-10-10T12:00:00Z", reconciliationSha256: "synthetic-hash" }))
      .resolves.toMatchObject({ orderId, buyerDiscordId: null, orderStatus: "paid" });
  });

  it.each([null, ""])("rejeita comprador inválido %s antes de retornar claim Discord", async buyerDiscordId => {
    const { repository: payments } = repository({ claimed_order_id: orderId, claimed: true,
      buyer_discord_id: buyerDiscordId });
    await expect(payments.claimTicket(orderId)).rejects.toThrow("ticket Discord sem comprador válido");
  });

  it("mantém o claim Discord legado estrito", async () => {
    const { repository: payments, rpc } = repository({ claimed_order_id: orderId, claimed: true,
      discord_guild_id: "123456789012345678", buyer_discord_id: buyerId, product_name: "Produto",
      order_quantity: 2, paid_amount_cents: 500, ticket_status: "creating", existing_channel_id: null });
    await expect(payments.claimTicket(orderId)).resolves.toMatchObject({ orderId, buyerDiscordId: buyerId, claimed: true });
    expect(rpc).toHaveBeenCalledWith("claim_discord_ticket", { p_order_id: orderId });
  });
});
