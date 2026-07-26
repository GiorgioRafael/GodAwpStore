import type { LivePixCheckout, LivePixPayment } from "@/lib/livepix/client";
import { LIVEPIX_MINIMUM_BRL_CENTS } from "@/lib/livepix/limits";
import { reconciliationDigest } from "@/lib/livepix/payment-service";
import { STORE_NAME } from "@/lib/brand";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Seconds the polling fallback must wait before pulling LivePix again. */
export const ROULETTE_PROVIDER_CHECK_INTERVAL_SECONDS = 5;

export type RouletteSpinChargeStatus = "awaiting_payment" | "paid" | "consumed" | "expired";

export type StoredRouletteCheckout = {
  chargeId: string;
  providerReference: string;
  checkoutUrl: string;
};

export type RouletteCheckoutClaim = {
  claimed: boolean;
  amountCents: number;
  checkout: StoredRouletteCheckout | null;
};

export type RouletteSpinPaymentConfirmation = {
  chargeId: string;
  status: RouletteSpinChargeStatus;
  paidAmountCents: number;
  firstConfirmation: boolean;
};

export interface RouletteSpinPaymentRepository {
  findCheckoutByReference(providerReference: string): Promise<StoredRouletteCheckout | null>;
  findCheckoutByCharge(chargeId: string): Promise<StoredRouletteCheckout | null>;
  claimCheckout(chargeId: string, claimToken: string): Promise<RouletteCheckoutClaim>;
  registerCheckout(
    input: StoredRouletteCheckout & { claimToken: string },
  ): Promise<StoredRouletteCheckout>;
  releaseCheckoutClaim(chargeId: string, claimToken: string): Promise<void>;
  claimProviderCheck(chargeId: string, minimumIntervalSeconds: number): Promise<boolean>;
  confirmPayment(input: {
    providerPaymentId: string;
    providerProof: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    providerCreatedAt: string;
    reconciliationSha256: string;
  }): Promise<RouletteSpinPaymentConfirmation>;
}

type PaymentClient = {
  createPayment(input: { amountCents: number; redirectUrl: string }): Promise<LivePixCheckout>;
  getPaymentByReference(reference: string): Promise<LivePixPayment>;
};

/**
 * LivePix checkout for the R$ 1,00 roulette spin. It reuses the store payment
 * provider and the same reconciliation digest as the commerce orders, but keeps
 * a dedicated ledger so a spin never touches stock, tickets or balances.
 */
export class RouletteSpinPaymentService {
  constructor(
    private readonly repository: RouletteSpinPaymentRepository,
    private readonly client: PaymentClient,
  ) {}

  async createCheckout(chargeId: string, siteUrl: string): Promise<StoredRouletteCheckout> {
    assertUuid(chargeId);

    const claimToken = crypto.randomUUID();
    const claim = await this.repository.claimCheckout(chargeId, claimToken);
    if (claim.checkout) return claim.checkout;
    if (!claim.claimed) {
      throw new Error("O Pix deste giro já está sendo preparado. Tente novamente em instantes.");
    }
    if (
      !Number.isSafeInteger(claim.amountCents) ||
      claim.amountCents < LIVEPIX_MINIMUM_BRL_CENTS
    ) {
      throw new Error("O valor do giro não é aceito pela LivePix.");
    }

    const origin = readOrigin(siteUrl);
    let checkout: LivePixCheckout;
    try {
      checkout = await this.client.createPayment({
        amountCents: claim.amountCents,
        redirectUrl: `${origin}/roleta?giro=${encodeURIComponent(chargeId)}`,
      });
    } catch (error) {
      await this.repository.releaseCheckoutClaim(chargeId, claimToken).catch(() => undefined);
      throw error;
    }

    return this.repository.registerCheckout({
      chargeId,
      claimToken,
      providerReference: checkout.reference,
      checkoutUrl: checkout.checkoutUrl,
    });
  }

  /** Confirms a spin charge from a LivePix webhook notification. */
  async reconcilePayment(input: {
    providerPaymentId: string;
    providerReference: string;
  }): Promise<RouletteSpinPaymentConfirmation | null> {
    const checkout = await this.repository.findCheckoutByReference(input.providerReference);
    if (!checkout) return null;

    const payment = await this.client.getPaymentByReference(input.providerReference);
    if (
      payment.id !== input.providerPaymentId ||
      payment.reference !== checkout.providerReference
    ) {
      throw new Error("O pagamento LivePix não corresponde ao giro registrado.");
    }

    return this.confirm(payment);
  }

  /**
   * Polling fallback used while the browser waits on the wheel. A delayed or
   * missing webhook must not strand a spin the player already paid for.
   */
  async pullPendingPayment(
    chargeId: string,
  ): Promise<RouletteSpinPaymentConfirmation | null> {
    assertUuid(chargeId);
    const checkout = await this.repository.findCheckoutByCharge(chargeId);
    if (!checkout) return null;

    const due = await this.repository.claimProviderCheck(
      chargeId,
      ROULETTE_PROVIDER_CHECK_INTERVAL_SECONDS,
    );
    if (!due) return null;

    let payment: LivePixPayment;
    try {
      payment = await this.client.getPaymentByReference(checkout.providerReference);
    } catch {
      // An unpaid charge has no payment yet, which the provider reports as a
      // missing record. Keep polling instead of surfacing a failure.
      return null;
    }
    if (payment.reference !== checkout.providerReference) return null;

    return this.confirm(payment);
  }

  private confirm(payment: LivePixPayment) {
    return reconciliationDigest(payment).then((reconciliationSha256) =>
      this.repository.confirmPayment({
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
  if (!UUID_PATTERN.test(value)) throw new Error("ID do giro inválido.");
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
