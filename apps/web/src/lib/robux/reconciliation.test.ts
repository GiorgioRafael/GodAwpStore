import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { recoverRobuxOrder } from "./reconciliation";
import type { RobuxPaymentService } from "./payment-service";
import type { ensurePaidOrderTicket } from "@/lib/bot/discord-ticket";

const order = { id: "550e8400-e29b-41d4-a716-446655440000", payment_status: "pending", payment_provider_reference: "stored-ref" };
function dependencies() {
  const payments = {
    reconcileStoredCheckout: vi.fn().mockResolvedValue({ orderId: order.id }),
    claimTicket: vi.fn().mockResolvedValue({ claimed: true, orderId: order.id, discordGuildId: "123456789012345678", buyerDiscordId: "223456789012345678", robuxQuantity: 360, paidAmountCents: 1440 }),
    completeTicket: vi.fn().mockResolvedValue(undefined),
    failTicket: vi.fn().mockResolvedValue(undefined),
  };
  const open = vi.fn().mockResolvedValue({ channelId: "323456789012345678" });
  const run = (candidate = order) => recoverRobuxOrder(candidate, payments as unknown as RobuxPaymentService, open as typeof ensurePaidOrderTicket);
  return { payments, open, run };
}
describe("Robux recovery", () => {
  it("reconcilia pagamento perdido e abre ticket com controles de Robux", async () => {
    const { payments, open, run } = dependencies();
    expect(await run()).toBe("opened");
    expect(payments.reconcileStoredCheckout).toHaveBeenCalledWith("stored-ref");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ controls: "robux", quantity: 360, paidAmountCents: 1440 }));
    expect(payments.completeTicket).toHaveBeenCalledWith(order.id, "323456789012345678");
  });
  it("não abre ticket sem pagamento confirmado", async () => {
    const { payments, open, run } = dependencies();
    payments.reconcileStoredCheckout.mockResolvedValue(null);
    expect(await run()).toBe("pending");
    expect(payments.claimTicket).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it("não duplica ticket já reservado ou aberto", async () => {
    const { payments, open, run } = dependencies();
    payments.claimTicket.mockResolvedValue({ claimed: false });
    expect(await run()).toBe("skipped");
    expect(open).not.toHaveBeenCalled();
  });
  it("libera tentativa se Discord falhar para permitir recuperação posterior", async () => {
    const { payments, open, run } = dependencies();
    open.mockRejectedValue(new Error("Discord unavailable"));
    await expect(run()).rejects.toThrow("Discord unavailable");
    expect(payments.failTicket).toHaveBeenCalledWith(order.id);
    expect(payments.completeTicket).not.toHaveBeenCalled();
  });
  it("recupera pedido já pago sem consultar a LivePix outra vez", async () => {
    const { payments, run } = dependencies();
    expect(await run({ ...order, payment_status: "paid" })).toBe("opened");
    expect(payments.reconcileStoredCheckout).not.toHaveBeenCalled();
  });
  it("não abre pedido quando a referência aponta para outro pedido", async () => {
    const { payments, open, run } = dependencies();
    payments.reconcileStoredCheckout.mockResolvedValue({ orderId: "different-order" });
    await expect(run()).rejects.toThrow("outro pedido");
    expect(open).not.toHaveBeenCalled();
  });
});
