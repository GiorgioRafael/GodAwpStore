import "server-only";

import { getLivePixClient, type LivePixPayment } from "@/lib/livepix/client";
import { reconciliationDigest } from "@/lib/livepix/payment-service";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  calculateRobuxPriceCents,
  formatRobuxQuantity,
  MAXIMUM_ROBUX_QUANTITY,
  MINIMUM_ROBUX_QUANTITY,
} from "./pricing";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GWSTORE_PUBLIC_SITE_URL = "https://gwstore.vercel.app";

type RpcError = { message: string; code?: string } | null;
type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError }>;
};

export type RobuxPaymentConfirmation = {
  orderId: string;
  discordGuildId: string;
  buyerDiscordId: string;
  robuxQuantity: number;
  paidAmountCents: number;
  ticketStatus: string;
};

export type RobuxTicketClaim = RobuxPaymentConfirmation & {
  claimed: boolean;
  existingChannelId: string | null;
};

export class RobuxPaymentService {
  private readonly client: RpcClient;

  constructor(client: RpcClient = requireClient()) {
    this.client = client;
  }

  async createCheckout(input: {
    discordGuildId: string;
    buyerDiscordId: string;
    discordInteractionId: string;
    robuxQuantity: number;
  }) {
    assertSnowflake(input.discordGuildId, "servidor");
    assertSnowflake(input.buyerDiscordId, "comprador");
    assertSnowflake(input.discordInteractionId, "interação");
    if (!calculateRobuxPriceCents(input.robuxQuantity)) {
      throw new Error(
        `Informe entre ${formatRobuxQuantity(MINIMUM_ROBUX_QUANTITY)} e ${formatRobuxQuantity(MAXIMUM_ROBUX_QUANTITY)} Robux.`,
      );
    }

    const created = await this.rpcRow("create_robux_livepix_order", {
      p_discord_guild_id: input.discordGuildId,
      p_buyer_discord_id: input.buyerDiscordId,
      p_discord_interaction_id: input.discordInteractionId,
      p_robux_quantity: input.robuxQuantity,
    });
    const orderId = stringField(created, "order_id");
    const amountCents = integerField(created, "amount_cents");
    if (!UUID_PATTERN.test(orderId) || !Number.isSafeInteger(amountCents) || amountCents < 100) {
      throw new Error("O pedido de Robux retornou dados inválidos.");
    }

    const claimToken = crypto.randomUUID();
    const claim = await this.rpcRow("claim_robux_livepix_checkout", {
      p_order_id: orderId,
      p_claim_token: claimToken,
    });
    const existingReference = nullableStringField(claim, "provider_reference");
    const existingUrl = nullableStringField(claim, "checkout_url");
    if (existingReference && existingUrl) {
      return { orderId, amountCents, checkoutUrl: existingUrl };
    }
    if (claim.claimed !== true) {
      throw new Error("O Pix está sendo preparado. Tente novamente em alguns segundos.");
    }

    let checkout;
    try {
      checkout = await getLivePixClient().createPayment({
        amountCents,
        redirectUrl: robuxPaymentReturnUrl(orderId),
      });
    } catch (error) {
      await this.rpc("release_robux_livepix_checkout_claim", {
        p_order_id: orderId,
        p_claim_token: claimToken,
      }).catch(() => undefined);
      throw error;
    }

    try {
      const registered = await this.rpcRow("register_claimed_robux_livepix_checkout", {
        p_order_id: orderId,
        p_claim_token: claimToken,
        p_provider_reference: checkout.reference,
        p_checkout_url: checkout.checkoutUrl,
      });
      return {
        orderId: stringField(registered, "registered_order_id"),
        amountCents,
        checkoutUrl: stringField(registered, "checkout_url"),
      };
    } catch (error) {
      const existing = await this.rpcRowOrNull("find_robux_livepix_checkout_by_order", {
        p_order_id: orderId,
      });
      const checkoutUrl = existing ? nullableStringField(existing, "checkout_url") : null;
      if (checkoutUrl) return { orderId, amountCents, checkoutUrl };
      throw error;
    }
  }

  async reconcilePayment(input: {
    providerPaymentId: string;
    providerReference: string;
  }): Promise<RobuxPaymentConfirmation | null> {
    const checkout = await this.rpcRowOrNull("find_robux_livepix_checkout_by_reference", {
      p_provider_reference: input.providerReference,
    });
    if (!checkout) return null;

    const payment = await getLivePixClient().getPaymentByReference(input.providerReference);
    if (payment.id !== input.providerPaymentId || payment.reference !== input.providerReference) {
      throw new Error("O pagamento LivePix não corresponde ao pedido de Robux.");
    }
    return this.confirmPayment(payment);
  }

  async claimTicket(orderId: string): Promise<RobuxTicketClaim> {
    const row = await this.rpcRow("claim_robux_discord_ticket", { p_order_id: orderId });
    return readTicketClaim(row);
  }

  async completeTicket(orderId: string, channelId: string) {
    assertUuid(orderId);
    assertSnowflake(channelId, "canal do ticket");
    await this.rpcRow("complete_robux_discord_ticket", {
      p_order_id: orderId,
      p_channel_id: channelId,
    });
  }

  async failTicket(orderId: string) {
    assertUuid(orderId);
    await this.rpcRow("fail_robux_discord_ticket", { p_order_id: orderId });
  }

  private async confirmPayment(payment: LivePixPayment): Promise<RobuxPaymentConfirmation> {
    const row = await this.rpcRow("confirm_robux_livepix_payment", {
      p_provider_checkout_id: payment.id,
      p_provider_proof_id: payment.proof,
      p_provider_reference: payment.reference,
      p_amount_cents: payment.amountCents,
      p_currency_code: payment.currency,
      p_provider_created_at: payment.createdAt,
      p_reconciliation_sha256: await reconciliationDigest(payment),
    });
    return readConfirmation(row);
  }

  private async rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw new Error(`Falha no pagamento de Robux: ${error.message}`);
    return data;
  }

  private async rpcRow(name: string, args: Record<string, unknown>) {
    const data = await this.rpc(name, args);
    const row = firstRow(data);
    if (!row) throw new Error("O pagamento de Robux não retornou dados.");
    return row;
  }

  private async rpcRowOrNull(name: string, args: Record<string, unknown>) {
    return firstRow(await this.rpc(name, args));
  }
}

let robuxPaymentService: RobuxPaymentService | undefined;

export function getRobuxPaymentService() {
  robuxPaymentService ??= new RobuxPaymentService();
  return robuxPaymentService;
}

export function robuxPaymentReturnUrl(orderId: string) {
  assertUuid(orderId);
  return new URL(`/pagamento/${orderId}`, GWSTORE_PUBLIC_SITE_URL).toString();
}

function requireClient(): RpcClient {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client as unknown as RpcClient;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return isObject(value[0]) ? value[0] : null;
  return isObject(value) ? value : null;
}

function readConfirmation(row: Record<string, unknown>): RobuxPaymentConfirmation {
  const result = {
    orderId: stringField(row, "processed_order_id"),
    discordGuildId: stringField(row, "discord_guild_id"),
    buyerDiscordId: stringField(row, "buyer_discord_id"),
    robuxQuantity: integerField(row, "robux_quantity"),
    paidAmountCents: integerField(row, "paid_amount_cents"),
    ticketStatus: stringField(row, "ticket_status"),
  };
  assertUuid(result.orderId);
  assertSnowflake(result.discordGuildId, "servidor");
  assertSnowflake(result.buyerDiscordId, "comprador");
  if (!calculateRobuxPriceCents(result.robuxQuantity) || result.paidAmountCents < 100) {
    throw new Error("A confirmação de Robux retornou uma quantidade inválida.");
  }
  return result;
}

function readTicketClaim(row: Record<string, unknown>): RobuxTicketClaim {
  const confirmation = {
    orderId: stringField(row, "claimed_order_id"),
    discordGuildId: stringField(row, "discord_guild_id"),
    buyerDiscordId: stringField(row, "buyer_discord_id"),
    robuxQuantity: integerField(row, "robux_quantity"),
    paidAmountCents: integerField(row, "paid_amount_cents"),
    ticketStatus: stringField(row, "ticket_status"),
  };
  assertUuid(confirmation.orderId);
  assertSnowflake(confirmation.discordGuildId, "servidor");
  assertSnowflake(confirmation.buyerDiscordId, "comprador");
  return {
    ...confirmation,
    claimed: row.claimed === true,
    existingChannelId: nullableStringField(row, "existing_channel_id"),
  };
}

function stringField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) throw new Error("Resposta inválida do banco.");
  return value.trim();
}

function nullableStringField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Resposta inválida do banco.");
  return parsed;
}

function assertUuid(value: string) {
  if (!UUID_PATTERN.test(value)) throw new Error("ID de pedido de Robux inválido.");
}

function assertSnowflake(value: string, label: string) {
  if (!SNOWFLAKE_PATTERN.test(value)) throw new Error(`ID do ${label} Discord inválido.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
