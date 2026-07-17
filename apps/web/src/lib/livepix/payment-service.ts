import "server-only";

import type { LivePixCheckout, LivePixPayment } from "./client";
import { LIVEPIX_MINIMUM_BRL_CENTS } from "./limits";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PayableOrder = {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
};

export type StoredCheckout = {
  orderId: string;
  providerReference: string;
  checkoutUrl: string;
};

export type CheckoutClaim = {
  claimed: boolean;
  checkout: StoredCheckout | null;
};

export type PaymentConfirmation = {
  orderId: string;
  discordGuildId: string;
  buyerDiscordId: string;
  productName: string;
  paidAmountCents: number;
  orderStatus: string;
  firstConfirmation: boolean;
  ticketChannelId: string | null;
  ticketStatus: string;
};

export type DiscordTicketClaim = {
  orderId: string;
  claimed: boolean;
  discordGuildId: string;
  buyerDiscordId: string;
  productName: string;
  quantity: number;
  paidAmountCents: number;
  ticketStatus: string;
  existingChannelId: string | null;
};

export interface LivePixPaymentRepository {
  findCheckoutByOrder(orderId: string): Promise<StoredCheckout | null>;
  findCheckoutByReference(providerReference: string): Promise<StoredCheckout | null>;
  findPayableOrder(orderId: string): Promise<PayableOrder | null>;
  claimCheckout(orderId: string, claimToken: string): Promise<CheckoutClaim>;
  registerCheckout(input: StoredCheckout & { claimToken: string }): Promise<StoredCheckout>;
  releaseCheckoutClaim(orderId: string, claimToken: string): Promise<void>;
  confirmPayment(input: {
    providerPaymentId: string;
    providerProof: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    providerCreatedAt: string;
    reconciliationSha256: string;
  }): Promise<PaymentConfirmation>;
  claimTicket(orderId: string): Promise<DiscordTicketClaim>;
  completeTicket(orderId: string, channelId: string): Promise<void>;
  failTicket(orderId: string): Promise<void>;
}

type PaymentClient = {
  createPayment(input: { amountCents: number; redirectUrl: string }): Promise<LivePixCheckout>;
  getPaymentByReference(reference: string): Promise<LivePixPayment>;
};

export class LivePixPaymentService {
  constructor(
    private readonly repository: LivePixPaymentRepository,
    private readonly client: PaymentClient,
  ) {}

  async createCheckout(orderId: string, siteUrl: string): Promise<StoredCheckout> {
    assertUuid(orderId);
    const existing = await this.repository.findCheckoutByOrder(orderId);
    if (existing) return existing;

    const order = await this.repository.findPayableOrder(orderId);
    if (!order || order.status !== "awaiting_payment" || order.currency !== "BRL") {
      throw new Error("O pedido não está disponível para pagamento.");
    }
    if (
      !Number.isSafeInteger(order.amountCents) ||
      order.amountCents < LIVEPIX_MINIMUM_BRL_CENTS
    ) {
      throw new Error("O valor do pedido não é aceito pela LivePix.");
    }

    const claimToken = crypto.randomUUID();
    const claim = await this.repository.claimCheckout(order.id, claimToken);
    if (claim.checkout) return claim.checkout;
    if (!claim.claimed) {
      throw new Error("O Pix deste pedido já está sendo preparado. Tente novamente em instantes.");
    }

    const origin = readOrigin(siteUrl);
    let checkout: LivePixCheckout;
    try {
      checkout = await this.client.createPayment({
        amountCents: order.amountCents,
        redirectUrl: `${origin}/pagamento/${order.id}`,
      });
    } catch (error) {
      await this.repository.releaseCheckoutClaim(order.id, claimToken).catch(() => undefined);
      throw error;
    }

    try {
      return await this.repository.registerCheckout({
        orderId: order.id,
        claimToken,
        providerReference: checkout.reference,
        checkoutUrl: checkout.checkoutUrl,
      });
    } catch (error) {
      const concurrent = await this.repository.findCheckoutByOrder(order.id);
      if (concurrent) return concurrent;
      throw error;
    }
  }

  async reconcilePayment(input: {
    providerPaymentId: string;
    providerReference: string;
  }): Promise<PaymentConfirmation | null> {
    const checkout = await this.repository.findCheckoutByReference(input.providerReference);
    if (!checkout) return null;

    const payment = await this.client.getPaymentByReference(input.providerReference);
    if (payment.id !== input.providerPaymentId || payment.reference !== checkout.providerReference) {
      throw new Error("O pagamento LivePix não corresponde ao checkout registrado.");
    }

    return this.repository.confirmPayment({
      providerPaymentId: payment.id,
      providerProof: payment.proof,
      providerReference: payment.reference,
      amountCents: payment.amountCents,
      currency: payment.currency,
      providerCreatedAt: payment.createdAt,
      reconciliationSha256: await reconciliationDigest(payment),
    });
  }

  claimTicket(orderId: string) {
    return this.repository.claimTicket(orderId);
  }

  completeTicket(orderId: string, channelId: string) {
    return this.repository.completeTicket(orderId, channelId);
  }

  failTicket(orderId: string) {
    return this.repository.failTicket(orderId);
  }
}

async function reconciliationDigest(payment: LivePixPayment) {
  const canonical = [
    payment.id,
    payment.proof,
    payment.reference,
    String(payment.amountCents),
    payment.currency,
    payment.createdAt,
  ].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertUuid(value: string) {
  if (!UUID_PATTERN.test(value)) throw new Error("ID do pedido inválido.");
}

function readOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL pública da GWStore inválida.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL pública da GWStore inválida.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("URL pública da GWStore deve usar HTTPS em produção.");
  }
  return url.origin;
}
