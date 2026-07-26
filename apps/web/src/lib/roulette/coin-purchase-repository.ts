import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import type {
  RouletteCheckoutClaim,
  RouletteCoinCredit,
  RouletteCoinPurchaseRepository,
  RouletteCoinPurchaseStatus,
  StoredRouletteCheckout,
} from "./coin-purchase";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export class SupabaseRouletteCoinPurchaseRepository implements RouletteCoinPurchaseRepository {
  constructor(private readonly client: AdminClient = requireClient()) {}

  async findCheckoutByReference(providerReference: string): Promise<StoredRouletteCheckout | null> {
    const { data, error } = await this.client
      .from("roulette_coin_purchases")
      .select("id,payment_provider_reference,payment_checkout_url")
      .eq("payment_provider", "livepix")
      .eq("payment_provider_reference", providerReference)
      .maybeSingle();
    assertQuery(error, "busca da compra pela referência LivePix");
    return toStoredCheckout(data);
  }

  async findCheckoutByPurchase(purchaseId: string): Promise<StoredRouletteCheckout | null> {
    const { data, error } = await this.client
      .from("roulette_coin_purchases")
      .select("id,payment_provider_reference,payment_checkout_url")
      .eq("id", purchaseId)
      .eq("payment_provider", "livepix")
      .maybeSingle();
    assertQuery(error, "busca do checkout da compra");
    return toStoredCheckout(data);
  }

  async claimCheckout(purchaseId: string, claimToken: string): Promise<RouletteCheckoutClaim> {
    const { data, error } = await this.client
      .rpc("claim_roulette_coin_checkout", {
        p_purchase_id: purchaseId,
        p_claim_token: claimToken,
      })
      .single();
    assertQuery(error, "reserva da criação do checkout de moedas");
    return {
      claimed: data.claim_succeeded,
      amountCents: safeInteger(data.claimed_amount_cents),
      checkout:
        data.claimed_provider_reference && data.claimed_checkout_url
          ? {
              purchaseId: data.claimed_purchase_id,
              providerReference: data.claimed_provider_reference,
              checkoutUrl: data.claimed_checkout_url,
            }
          : null,
    };
  }

  async registerCheckout(
    input: StoredRouletteCheckout & { claimToken: string },
  ): Promise<StoredRouletteCheckout> {
    const { data, error } = await this.client
      .rpc("register_roulette_coin_checkout", {
        p_purchase_id: input.purchaseId,
        p_claim_token: input.claimToken,
        p_provider_reference: input.providerReference,
        p_checkout_url: input.checkoutUrl,
      })
      .single();
    assertQuery(error, "registro do checkout de moedas");
    return {
      purchaseId: data.registered_purchase_id,
      providerReference: data.registered_provider_reference,
      checkoutUrl: data.registered_checkout_url,
    };
  }

  async releaseCheckoutClaim(purchaseId: string, claimToken: string): Promise<void> {
    const { error } = await this.client.rpc("release_roulette_coin_checkout_claim", {
      p_purchase_id: purchaseId,
      p_claim_token: claimToken,
    });
    assertQuery(error, "liberação da criação do checkout de moedas");
  }

  async claimProviderCheck(purchaseId: string, minimumIntervalSeconds: number): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_roulette_coin_provider_check", {
      p_purchase_id: purchaseId,
      p_minimum_interval_seconds: minimumIntervalSeconds,
    });
    assertQuery(error, "consulta do pagamento das moedas na LivePix");
    return data === true;
  }

  async creditPurchase(input: {
    providerPaymentId: string;
    providerProof: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    providerCreatedAt: string;
    reconciliationSha256: string;
  }): Promise<RouletteCoinCredit> {
    const { data, error } = await this.client
      .rpc("confirm_roulette_coin_purchase", {
        p_provider_payment_id: input.providerPaymentId,
        p_provider_proof_id: input.providerProof,
        p_provider_reference: input.providerReference,
        p_amount_cents: input.amountCents,
        p_currency_code: input.currency,
        p_provider_created_at: input.providerCreatedAt,
        p_reconciliation_sha256: input.reconciliationSha256,
      })
      .single();
    assertQuery(error, "confirmação da compra de moedas");
    return {
      purchaseId: data.confirmed_purchase_id,
      status: data.confirmed_status as RouletteCoinPurchaseStatus,
      creditedAmountCents: safeInteger(data.credited_amount_cents),
      coinBalanceCents: safeInteger(data.coin_balance_cents),
      firstConfirmation: data.first_confirmation,
    };
  }
}

function toStoredCheckout(
  data: {
    id: string;
    payment_provider_reference: string | null;
    payment_checkout_url: string | null;
  } | null,
): StoredRouletteCheckout | null {
  if (!data?.payment_provider_reference || !data.payment_checkout_url) return null;
  return {
    purchaseId: data.id,
    providerReference: data.payment_provider_reference,
    checkoutUrl: data.payment_checkout_url,
  };
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
