export type PaymentReturnStatus =
  | "ticket_open"
  | "paid"
  | "pending"
  | "expired"
  | "late_payment"
  | "refunded"
  | "failed"
  | "unknown";

type PaymentStatusRow = {
  status: string;
  payment_status: string;
  discord_ticket_status: string;
  late_payment_detected_at: string | null;
};

export function resolvePaymentReturnStatus(row: PaymentStatusRow): PaymentReturnStatus {
  if (row.status === "refunded" || row.payment_status === "refunded") return "refunded";
  if (row.discord_ticket_status === "open") return "ticket_open";
  if (["paid", "processing", "delivered"].includes(row.status)) return "paid";
  if (row.payment_status === "failed" || row.status === "failed") return "failed";
  if (
    row.late_payment_detected_at ||
    (["cancelled", "expired"].includes(row.status) && row.payment_status === "paid")
  ) {
    return "late_payment";
  }
  if (
    ["cancelled", "expired"].includes(row.status) ||
    ["cancelled", "expired"].includes(row.payment_status)
  ) {
    return "expired";
  }
  return "pending";
}

export function paymentReturnCopy(status: PaymentReturnStatus) {
  if (status === "ticket_open") {
    return {
      title: "Pagamento confirmado",
      description: "Seu ticket privado já foi criado no Discord. Volte ao servidor para receber o atendimento.",
    };
  }
  if (status === "paid") {
    return {
      title: "Pagamento confirmado",
      description: "Recebemos a confirmação e estamos abrindo seu ticket privado no Discord.",
    };
  }
  if (status === "late_payment") {
    return {
      title: "Pagamento recebido após o prazo",
      description:
        "O pedido continua cancelado e não será entregue automaticamente. Fale com um administrador no Discord para análise e possível reembolso.",
    };
  }
  if (status === "expired") {
    return {
      title: "Pedido cancelado",
      description:
        "O prazo de 2 horas terminou sem aprovação do pagamento e o estoque foi restabelecido. Volte ao Discord para criar um novo pedido.",
    };
  }
  if (status === "refunded") {
    return {
      title: "Pagamento reembolsado",
      description: "Este pagamento foi reembolsado. Fale com um administrador no Discord se precisar de ajuda.",
    };
  }
  if (status === "failed") {
    return {
      title: "Não foi possível confirmar",
      description: "A cobrança não foi confirmada. Volte ao Discord e tente novamente ou fale com um administrador.",
    };
  }
  if (status === "pending") {
    return {
      title: "Aguardando confirmação",
      description: "Se você concluiu o Pix, aguarde alguns instantes enquanto a LivePix confirma o pagamento.",
    };
  }
  return {
    title: "Status indisponível",
    description: "Não encontramos esse retorno de pagamento. Volte ao Discord e confira o pedido.",
  };
}
