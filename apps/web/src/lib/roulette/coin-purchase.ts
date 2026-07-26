import type { LivePixCheckout, LivePixPayment } from "@/lib/livepix/client";
import { LIVEPIX_MINIMUM_BRL_CENTS } from "@/lib/livepix/limits";
import { reconciliationDigest } from "@/lib/livepix/payment-service";
import { STORE_NAME } from "@/lib/brand";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Seconds the polling fallback must wait before pulling LivePix again. */
export const ROULETTE_PROVIDER_CHECK_INTERVAL_SECONDS = 5;

export type RouletteCoinPurchaseStatus = "awaiting_payment" | "credited" | "expired";

export type StoredRouletteCheckout = {
  purchaseId: string;
  providerReference: string;
  checkoutUrl: string;
};

export type RouletteCheckoutClaim = {
  claimed: boolean;
  amountCents: number;
  checkout: StoredRouletteCheckout | null;
};

export type RouletteCoinCredit = {
  purchaseId: string;
  status: RouletteCoinPurchaseStatus;
  creditedAmountCents: number;
  coinBalanceCents: number;
  firstConfirmation: boolean;
};

export interface RouletteCoinPurchaseRepository {
  findCheckoutByReference(providerReference: string): Promise<StoredRouletteCheckout | null>;
  findCheckoutByPurchase(purchaseId: string): Promise<StoredRouletteCheckout | null>;
  claimCheckout(purchaseId: string, claimToken: string): Promise<RouletteCheckoutClaim>;
  registerCheckout(
    input: StoredRouletteCheckout & { claimToken: string },
  ): Promise<StoredRouletteCheckout>;
  releaseCheckoutClaim(purchaseId: string, claimToken: string): Promise<void>;
  claimProviderCheck(purchaseId: string, minimumIntervalSeconds: number): Promise<boolean>;
  creditPurchase(input: {
    providerPaymentId: string;
    providerProof: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    providerCreatedAt: string;
    reconciliationSha256: string;
  }): Promise<RouletteCoinCredit>;
}

type PaymentClient = {
  createPayment(input: { amountCents: number; redirectUrl: string }): Promise<LivePixCheckout>;
  getPaymentByReference(reference: string): Promise<LivePixPayment>;
};

/**
 * LivePix checkout that buys roulette coins at R$ 1,00 each. It reuses the store
 * payment provider and the same reconciliation digest as the commerce orders,
 * but keeps a dedicated ledger so coins never touch stock, balances or tickets.
 */
export class RouletteCoinPurchaseService {
  constructor(
    private readonly repository: RouletteCoinPurchaseRepository,
    private readonly client: PaymentClient,
  ) {}

  async createCheckout(purchaseId: string, siteUrl: string): Promise<StoredRouletteCheckout> {
    assertUuid(purchaseId);

    const claimToken = crypto.randomUUID();
    const claim = await this.repository.claimCheckout(purchaseId, claimToken);
    if (claim.checkout) return claim.checkout;
    if (!claim.claimed) {
      throw new Error(
        "O Pix destas moedas já está sendo preparado. Tente novamente em instantes.",
      );
    }
    if (
      !Number.isSafeInteger(claim.amountCents) ||
      claim.amountCents < LIVEPIX_MINIMUM_BRL_CENTS
    ) {
      throw new Error("O valor da compra não é aceito pela LivePix.");
    }

    const origin = readOrigin(siteUrl);
    let checkout: LivePixCheckout;
    try {
      checkout = await this.client.createPayment({
        amountCents: claim.amountCents,
        redirectUrl: `${origin}/roleta?compra=${encodeURIComponent(purchaseId)}`,
      });
    } catch (error) {
      await this.repository.releaseCheckoutClaim(purchaseId, claimToken).catch(() => undefined);
      throw error;
    }

    return this.repository.registerCheckout({
      purchaseId,
      claimToken,
      providerReference: checkout.reference,
      checkoutUrl: checkout.checkoutUrl,
    });
  }

  /** Credits the coins of a purchase from a LivePix webhook notification. */
  async reconcilePayment(input: {
    providerPaymentId: string;
    providerReference: string;
  }): Promise<RouletteCoinCredit | null> {
    const checkout = await this.repository.findCheckoutByReference(input.providerReference);
    if (!checkout) return null;

    const payment = await this.client.getPaymentByReference(input.providerReference);
    if (
      payment.id !== input.providerPaymentId ||
      payment.reference !== checkout.providerReference
    ) {
      throw new Error("O pagamento LivePix não corresponde à compra registrada.");
    }

    return this.credit(payment);
  }

  /**
   * Polling fallback used while the browser waits for the coins. A delayed or
   * missing webhook must not strand coins the player already paid for.
   */
  async pullPendingPayment(purchaseId: string): Promise<RouletteCoinCredit | null> {
    assertUuid(purchaseId);
    const checkout = await this.repository.findCheckoutByPurchase(purchaseId);
    if (!checkout) return null;

    const due = await this.repository.claimProviderCheck(
      purchaseId,
      ROULETTE_PROVIDER_CHECK_INTERVAL_SECONDS,
    );
    if (!due) return null;

    let payment: LivePixPayment;
    try {
      payment = await this.client.getPaymentByReference(checkout.providerReference);
    } catch {
      // An unpaid purchase has no payment yet, which the provider reports as a
      // missing record. Keep polling instead of surfacing a failure.
      return null;
    }
    if (payment.reference !== checkout.providerReference) return null;

    return this.credit(payment);
  }

  private credit(payment: LivePixPayment) {
    return reconciliationDigest(payment).then((reconciliationSha256) =>
      this.repository.creditPurchase({
        providerPaymentId: payment.id,
        providerProof: payment.proof,
        providerReference: payment.reference,
        amountCents: payment.amountCents,
        currency: payment.currency,
        providerCreatedAt: payment.createdAt,
        reconciliationSha256,
      }),
    );
  }
}

function assertUuid(value: string) {
  if (!UUID_PATTERN.test(value)) throw new Error("ID da compra inválido.");
}

function readOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`URL pública da ${STORE_NAME} inválida.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`URL pública da ${STORE_NAME} inválida.`);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`URL pública da ${STORE_NAME} deve usar HTTPS em produção.`);
  }
  return url.origin;
}
