import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

import type {
  DiscordTicketClaim,
  LivePixPaymentRepository,
  PayableOrder,
  PaymentConfirmation,
  StoredCheckout,
} from "./payment-service";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export class SupabaseLivePixPaymentRepository implements LivePixPaymentRepository {
  constructor(private readonly client: AdminClient = requireClient()) {}

  async findCheckoutByOrder(orderId: string): Promise<StoredCheckout | null> {
    const { data, error } = await this.client
      .from("orders")
      .select("id,payment_provider_reference,payment_checkout_url")
      .eq("id", orderId)
      .eq("payment_provider", "livepix")
      .eq("status", "awaiting_payment")
      .in("payment_status", ["uninitialized", "pending"])
      .gt("payment_expires_at", new Date().toISOString())
      .maybeSingle();
    assertQuery(error, "checkout do pedido");
    return toStoredCheckout(data);
  }

  async findCheckoutByReference(providerReference: string): Promise<StoredCheckout | null> {
    const { data, error } = await this.client
      .from("orders")
      .select("id,payment_provider_reference,payment_checkout_url")
      .eq("payment_provider", "livepix")
      .eq("payment_provider_reference", providerReference)
      .maybeSingle();
    assertQuery(error, "checkout da LivePix");
    return toStoredCheckout(data);
  }

  async findPayableOrder(orderId: string): Promise<PayableOrder | null> {
    const { data, error } = await this.client
      .from("orders")
      .select("id,status,sale_price_cents,currency_code,payment_expires_at")
      .eq("id", orderId)
      .maybeSingle();
    assertQuery(error, "pedido para pagamento");
    return data
      ? {
          id: data.id,
          status: data.status,
          amountCents: safeInteger(data.sale_price_cents),
          currency: data.currency_code,
          paymentExpiresAt: data.payment_expires_at,
        }
      : null;
  }

  async claimCheckout(orderId: string, claimToken: string) {
    const { data, error } = await this.client
      .rpc("claim_livepix_checkout", {
        p_order_id: orderId,
        p_claim_token: claimToken,
      })
      .single();
    assertQuery(error, "reserva da criação do checkout LivePix");
    return {
      claimed: data.claimed,
      checkout:
        data.provider_reference && data.checkout_url
          ? {
              orderId: data.claimed_order_id,
              providerReference: data.provider_reference,
              checkoutUrl: data.checkout_url,
            }
          : null,
    };
  }

  async registerCheckout(input: StoredCheckout & { claimToken: string }): Promise<StoredCheckout> {
    const { data, error } = await this.client
      .rpc("register_claimed_livepix_checkout", {
        p_order_id: input.orderId,
        p_claim_token: input.claimToken,
        p_provider_reference: input.providerReference,
        p_checkout_url: input.checkoutUrl,
        p_expires_at: null,
      })
      .single();
    assertQuery(error, "registro do checkout LivePix");
    return {
      orderId: data.registered_order_id,
      providerReference: data.provider_reference,
      checkoutUrl: data.checkout_url,
    };
  }

  async releaseCheckoutClaim(orderId: string, claimToken: string): Promise<void> {
    const { error } = await this.client.rpc("release_livepix_checkout_claim", {
      p_order_id: orderId,
      p_claim_token: claimToken,
    });
    assertQuery(error, "liberação da criação do checkout LivePix");
  }

  async confirmPayment(input: {
    providerPaymentId: string;
    providerProof: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    providerCreatedAt: string;
    reconciliationSha256: string;
  }): Promise<PaymentConfirmation> {
    const { data, error } = await this.client
      .rpc("confirm_livepix_payment", {
        p_provider_checkout_id: input.providerPaymentId,
        p_provider_proof_id: input.providerProof,
        p_provider_reference: input.providerReference,
        p_amount_cents: input.amountCents,
        p_currency_code: input.currency,
        p_provider_created_at: input.providerCreatedAt,
        p_reconciliation_sha256: input.reconciliationSha256,
      })
      .single();
    assertQuery(error, "confirmação do pagamento LivePix");
    return {
      orderId: data.processed_order_id,
      discordGuildId: data.discord_guild_id,
      buyerDiscordId: data.buyer_discord_id,
      productName: data.product_name,
      paidAmountCents: safeInteger(data.paid_amount_cents),
      orderStatus: data.resulting_order_status,
      firstConfirmation: data.first_confirmation,
      ticketChannelId: data.existing_ticket_channel_id,
      ticketStatus: data.ticket_status,
    };
  }

  async claimTicket(orderId: string): Promise<DiscordTicketClaim> {
    const { data, error } = await this.client
      .rpc("claim_discord_ticket", { p_order_id: orderId })
      .single();
    assertQuery(error, "reserva do ticket Discord");
    return {
      orderId: data.claimed_order_id,
      claimed: data.claimed,
      discordGuildId: data.discord_guild_id,
      buyerDiscordId: data.buyer_discord_id,
      productName: data.product_name,
      quantity: safeInteger(data.order_quantity),
      paidAmountCents: safeInteger(data.paid_amount_cents),
      ticketStatus: data.ticket_status,
      existingChannelId: data.existing_channel_id,
    };
  }

  async completeTicket(orderId: string, channelId: string): Promise<void> {
    const { error } = await this.client.rpc("complete_discord_ticket", {
      p_order_id: orderId,
      p_channel_id: channelId,
    });
    assertQuery(error, "conclusão do ticket Discord");
  }

  async failTicket(orderId: string): Promise<void> {
    const { error } = await this.client.rpc("fail_discord_ticket", { p_order_id: orderId });
    assertQuery(error, "falha do ticket Discord");
  }
}

function toStoredCheckout(data: {
  id: string;
  payment_provider_reference: string | null;
  payment_checkout_url: string | null;
} | null): StoredCheckout | null {
  if (!data?.payment_provider_reference || !data.payment_checkout_url) return null;
  return {
    orderId: data.id,
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

function safeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
