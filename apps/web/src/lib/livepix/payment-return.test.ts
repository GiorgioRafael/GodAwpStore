import { describe, expect, it } from "vitest";

import { paymentReturnCopy, resolvePaymentReturnStatus } from "./payment-return";

const pending = {
  status: "awaiting_payment",
  payment_status: "pending",
  discord_ticket_status: "not_created",
  late_payment_detected_at: null,
  stock_commit_failure_reason: null,
};

describe("retorno de pagamento", () => {
  it("explica o cancelamento sem baixa de estoque depois de trinta minutos", () => {
    const status = resolvePaymentReturnStatus({
      ...pending,
      status: "cancelled",
      payment_status: "cancelled",
    });

    expect(status).toBe("expired");
    expect(paymentReturnCopy(status)).toEqual(
      expect.objectContaining({
        title: "Pedido cancelado",
        description: expect.stringContaining("Nenhum item foi retirado do estoque"),
      }),
    );
  });

  it("não apresenta um pagamento tardio como pedido aprovado", () => {
    const status = resolvePaymentReturnStatus({
      ...pending,
      status: "cancelled",
      payment_status: "paid",
      late_payment_detected_at: "2026-07-17T15:00:01.000Z",
    });

    expect(status).toBe("late_payment");
    expect(paymentReturnCopy(status)).toEqual(
      expect.objectContaining({
        title: "Pagamento recebido após o prazo",
        description: expect.stringContaining("não será entregue automaticamente"),
      }),
    );
  });

  it("separa pagamento confirmado sem estoque para revisão manual", () => {
    const status = resolvePaymentReturnStatus({
      ...pending,
      status: "cancelled",
      payment_status: "paid",
      stock_commit_failure_reason: "insufficient_stock_after_payment",
    });

    expect(status).toBe("stock_unavailable");
    expect(paymentReturnCopy(status)).toEqual(
      expect.objectContaining({
        title: expect.stringContaining("análise"),
        description: expect.stringContaining("reembolso"),
      }),
    );
  });
});
