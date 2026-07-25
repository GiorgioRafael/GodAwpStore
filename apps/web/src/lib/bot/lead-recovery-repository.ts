import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

export type LeadRecoveryItem = {
  position: number;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  subtotalPriceCents: number;
  salePriceCents: number;
  discountAmountCents: number;
};

export type LeadRecoveryDeliveryClaim = {
  id: string;
  sourceOrderId: string;
  buyerDiscordId: string;
  items: LeadRecoveryItem[];
  originalSalePriceCents: number;
  recoveredSalePriceCents: number;
  discountBps: number;
  expiresAt: string;
};

export type LeadRecoveryFinalization = {
  orderId: string | null;
  created: boolean;
  declined: boolean;
  outOfStock: boolean;
  expired: boolean;
  invalidated: boolean;
  decisionConflict: boolean;
};

export class SupabaseLeadRecoveryRepository {
  constructor(private readonly client: AdminClient = requireClient()) {}

  async claimDeliveries(claimToken: string, batchSize = 25) {
    const { data, error } = await this.client.rpc("claim_lead_recovery_offers", {
      p_claim_token: claimToken,
      p_batch_size: batchSize,
    });
    assertQuery(error, "fila de recuperação de carrinhos");
    return (data ?? []).map((row): LeadRecoveryDeliveryClaim => ({
      id: row.offer_id,
      sourceOrderId: row.source_order_id,
      buyerDiscordId: row.buyer_discord_id,
      items: readItems(row.items),
      originalSalePriceCents: safeInteger(row.original_sale_price_cents),
      recoveredSalePriceCents: safeInteger(row.recovered_sale_price_cents),
      discountBps: safeInteger(row.discount_bps),
      expiresAt: row.expires_at,
    }));
  }

  async completeDelivery(input: {
    offerId: string;
    claimToken: string;
    dmChannelId: string;
    dmMessageId: string;
  }) {
    const { data, error } = await this.client.rpc(
      "complete_lead_recovery_delivery",
      {
        p_offer_id: input.offerId,
        p_claim_token: input.claimToken,
        p_dm_channel_id: input.dmChannelId,
        p_dm_message_id: input.dmMessageId,
      },
    );
    assertQuery(error, "confirmação da mensagem de recuperação");
    return data;
  }

  async failDelivery(input: {
    offerId: string;
    claimToken: string;
    error: string;
  }) {
    const { data, error } = await this.client.rpc("fail_lead_recovery_delivery", {
      p_offer_id: input.offerId,
      p_claim_token: input.claimToken,
      p_error: input.error,
    });
    assertQuery(error, "registro da falha de recuperação");
    return data;
  }

  async finalize(input: {
    offerId: string;
    buyerDiscordId: string;
    accepted: boolean;
    decisionInteractionId: string;
  }): Promise<LeadRecoveryFinalization> {
    const { data, error } = await this.client
      .rpc("finalize_lead_recovery_offer", {
        p_offer_id: input.offerId,
        p_buyer_discord_id: input.buyerDiscordId,
        p_accept: input.accepted,
        p_decision_interaction_id: input.decisionInteractionId,
      })
      .single();
    assertQuery(error, "decisão da recuperação de carrinho");
    return {
      orderId: data.checkout_order_id,
      created: data.was_created,
      declined: data.declined,
      outOfStock: data.out_of_stock,
      expired: data.offer_expired,
      invalidated: data.offer_invalidated,
      decisionConflict: data.decision_conflict,
    };
  }
}

function readItems(value: Json): LeadRecoveryItem[] {
  if (!Array.isArray(value)) throw new Error("Carrinho de recuperação inválido.");
  const items = value.map((entry) => {
    if (!isObject(entry)) throw new Error("Item de recuperação inválido.");
    return {
      position: readPositiveInteger(entry.position),
      productId: readString(entry.product_id),
      productName: readString(entry.product_name),
      quantity: readPositiveInteger(entry.quantity),
      unitPriceCents: readPositiveInteger(entry.unit_price_cents),
      subtotalPriceCents: readPositiveInteger(entry.subtotal_price_cents),
      salePriceCents: readPositiveInteger(entry.sale_price_cents),
      discountAmountCents: readNonnegativeInteger(entry.discount_amount_cents),
    };
  });
  if (items.length < 1 || items.length > 3) {
    throw new Error("Carrinho de recuperação inválido.");
  }
  return items;
}

function readString(value: Json | undefined) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Campo de recuperação inválido.");
  }
  return value;
}

function readPositiveInteger(value: Json | undefined) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Valor de recuperação inválido.");
  }
  return value;
}

function readNonnegativeInteger(value: Json | undefined) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Valor de recuperação inválido.");
  }
  return value;
}

function safeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function assertQuery(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) throw new Error(`Falha ao processar ${operation}.`);
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function isObject(value: unknown): value is Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
