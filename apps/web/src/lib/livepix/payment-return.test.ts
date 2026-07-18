import { describe, expect, it } from "vitest";

import { paymentReturnCopy, resolvePaymentReturnStatus } from "./payment-return";

const pending = {
  status: "awaiting_payment",
  payment_status: "pending",
  discord_ticket_status: "not_created",
  late_payment_detected_at: null,
};

describe("retorno de pagamento", () => {
  it("explica o cancelamento e a reposição depois de duas horas", () => {
    const status = resolvePaymentReturnStatus({
      ...pending,
      status: "cancelled",
      payment_status: "cancelled",
    });

    expect(status).toBe("expired");
    expect(paymentReturnCopy(status)).toEqual(
      expect.objectContaining({
        title: "Pedido cancelado",
        description: expect.stringContaining("estoque foi restabelecido"),
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
});
