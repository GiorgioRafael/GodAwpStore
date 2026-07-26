import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import type {
  RouletteCheckoutClaim,
  RouletteSpinChargeStatus,
  RouletteSpinPaymentConfirmation,
  RouletteSpinPaymentRepository,
  StoredRouletteCheckout,
} from "./spin-payment";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export class SupabaseRouletteSpinPaymentRepository implements RouletteSpinPaymentRepository {
  constructor(private readonly client: AdminClient = requireClient()) {}

  async findCheckoutByReference(providerReference: string): Promise<StoredRouletteCheckout | null> {
    const { data, error } = await this.client
      .from("roulette_spin_charges")
      .select("id,payment_provider_reference,payment_checkout_url")
      .eq("payment_provider", "livepix")
      .eq("payment_provider_reference", providerReference)
      .maybeSingle();
    assertQuery(error, "busca do giro pela referência LivePix");
    if (!data?.payment_provider_reference || !data.payment_checkout_url) return null;
    return {
      chargeId: data.id,
      providerReference: data.payment_provider_reference,
      checkoutUrl: data.payment_checkout_url,
    };
  }

  async findCheckoutByCharge(chargeId: string): Promise<StoredRouletteCheckout | null> {
    const { data, error } = await this.client
      .from("roulette_spin_charges")
      .select("id,payment_provider_reference,payment_checkout_url")
      .eq("id", chargeId)
      .eq("payment_provider", "livepix")
      .maybeSingle();
    assertQuery(error, "busca do checkout do giro");
    if (!data?.payment_provider_reference || !data.payment_checkout_url) return null;
    return {
      chargeId: data.id,
      providerReference: data.payment_provider_reference,
      checkoutUrl: data.payment_checkout_url,
    };
  }

  async claimCheckout(chargeId: string, claimToken: string): Promise<RouletteCheckoutClaim> {
    const { data, error } = await this.client
      .rpc("claim_roulette_spin_checkout", {
        p_charge_id: chargeId,
        p_claim_token: claimToken,
      })
      .single();
    assertQuery(error, "reserva da criação do checkout do giro");
    return {
      claimed: data.claimed,
      amountCents: safeInteger(data.amount_cents),
      checkout:
        data.provider_reference && data.checkout_url
          ? {
              chargeId: data.claimed_charge_id,
              providerReference: data.provider_reference,
              checkoutUrl: data.checkout_url,
            }
          : null,
    };
  }

  async registerCheckout(
    input: StoredRouletteCheckout & { claimToken: string },
  ): Promise<StoredRouletteCheckout> {
    const { data, error } = await this.client
      .rpc("register_roulette_spin_checkout", {
        p_charge_id: input.chargeId,
        p_claim_token: input.claimToken,
        p_provider_reference: input.providerReference,
        p_checkout_url: input.checkoutUrl,
      })
      .single();
    assertQuery(error, "registro do checkout do giro");
    return {
      chargeId: data.registered_charge_id,
      providerReference: data.provider_reference,
      checkoutUrl: data.checkout_url,
    };
  }

  async releaseCheckoutClaim(chargeId: string, claimToken: string): Promise<void> {
    const { error } = await this.client.rpc("release_roulette_spin_checkout_claim", {
      p_charge_id: chargeId,
      p_claim_token: claimToken,
    });
    assertQuery(error, "liberação da criação do checkout do giro");
  }

  async claimProviderCheck(chargeId: string, minimumIntervalSeconds: number): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_roulette_spin_provider_check", {
      p_charge_id: chargeId,
      p_minimum_interval_seconds: minimumIntervalSeconds,
    });
    assertQuery(error, "consulta do pagamento do giro na LivePix");
    return data === true;
  }

  async confirmPayment(input: {
    providerPaymentId: string;
    providerProof: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    providerCreatedAt: string;
    reconciliationSha256: string;
  }): Promise<RouletteSpinPaymentConfirmation> {
    const { data, error } = await this.client
      .rpc("confirm_roulette_spin_payment", {
        p_provider_payment_id: input.providerPaymentId,
        p_provider_proof_id: input.providerProof,
        p_provider_reference: input.providerReference,
        p_amount_cents: input.amountCents,
        p_currency_code: input.currency,
        p_provider_created_at: input.providerCreatedAt,
        p_reconciliation_sha256: input.reconciliationSha256,
      })
      .single();
    assertQuery(error, "confirmação do pagamento do giro");
    return {
      chargeId: data.confirmed_charge_id,
      status: data.charge_status as RouletteSpinChargeStatus,
      paidAmountCents: safeInteger(data.paid_amount_cents),
      firstConfirmation: data.first_confirmation,
    };
  }
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function assertQuery(error: { message: string } | null, operation: string): asserts error is null {
  if (error) throw new Error(`Falha na ${operation}.`);
}

function safeInteger(value: number | null) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
