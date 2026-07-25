/** @jsxImportSource chat */
import "server-only";

import {
  cardToDiscordPayload,
  decodeDiscordCustomId,
  DiscordContentFormat,
} from "@chat-adapter/discord";
import {
  Actions,
  Button,
  Card,
  CardText,
  Divider,
  toCardElement,
  type ChatElement,
} from "chat";

import { getSiteUrl } from "@/lib/env";
import { getLivePixClient } from "@/lib/livepix/client";
import { LivePixPaymentService } from "@/lib/livepix/payment-service";
import { SupabaseLivePixPaymentRepository } from "@/lib/livepix/supabase-repository";
import { discordBotJson } from "./discord-api";
import { readDiscordInteraction } from "./discord-context";
import {
  cartPurchaseResultCard,
  updateDiscordEphemeralResponse,
} from "./discord-bot";
import {
  type LeadRecoveryDeliveryClaim,
  SupabaseLeadRecoveryRepository,
} from "./lead-recovery-repository";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  type BotMessageCustomization,
} from "./message-customization";
import { SupabaseBotCommerceRepository } from "./supabase-repository";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_DEFERRED_UPDATE_MESSAGE = 6;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCEPT_ACTION = "gwstore_lead_recovery_accept";
const DECLINE_ACTION = "gwstore_lead_recovery_decline";
const DELIVERY_BATCH_SIZE = 10;

export type NativeDiscordLeadRecoveryInteraction = {
  offerId: string;
  accepted: boolean;
  response: { type: 6 };
};

export function parseNativeDiscordLeadRecoveryInteraction(
  raw: unknown,
): NativeDiscordLeadRecoveryInteraction | null {
  if (
    !isObject(raw) ||
    raw.type !== DISCORD_MESSAGE_COMPONENT ||
    !isObject(raw.data) ||
    typeof raw.data.custom_id !== "string"
  ) {
    return null;
  }

  let decoded: ReturnType<typeof decodeDiscordCustomId>;
  try {
    decoded = decodeDiscordCustomId(raw.data.custom_id);
  } catch {
    return null;
  }
  if (decoded.actionId !== ACCEPT_ACTION && decoded.actionId !== DECLINE_ACTION) {
    return null;
  }
  const offerId =
    typeof decoded.value === "string" ? decoded.value.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(offerId)) return null;

  return {
    offerId,
    accepted: decoded.actionId === ACCEPT_ACTION,
    response: { type: DISCORD_DEFERRED_UPDATE_MESSAGE },
  };
}

export async function reconcileLeadRecoveryOffers(
  dependencies: {
    repository?: SupabaseLeadRecoveryRepository;
    fetcher?: typeof fetch;
  } = {},
) {
  const repository =
    dependencies.repository ?? new SupabaseLeadRecoveryRepository();
  const fetcher = dependencies.fetcher ?? fetch;
  const claimToken = crypto.randomUUID();
  const claims = await repository.claimDeliveries(
    claimToken,
    DELIVERY_BATCH_SIZE,
  );
  const result = {
    claimed: claims.length,
    sent: 0,
    failed: 0,
  };

  for (const claim of claims) {
    try {
      const delivery = await sendLeadRecoveryDm(claim, fetcher);
      const completed = await repository.completeDelivery({
        offerId: claim.id,
        claimToken,
        dmChannelId: delivery.channelId,
        dmMessageId: delivery.messageId,
      });
      if (!completed) {
        throw new Error("A reserva da mensagem de recuperação expirou.");
      }
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      const message =
        error instanceof Error ? error.message : "Falha desconhecida no Discord.";
      await repository
        .failDelivery({
          offerId: claim.id,
          claimToken,
          error: message,
        })
        .catch(() => undefined);
      console.error(`[lead-recovery:delivery] offer=${claim.id} ${message}`);
    }
  }

  return result;
}

export async function completeDiscordLeadRecoveryDecision(
  raw: unknown,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const parsed = parseNativeDiscordLeadRecoveryInteraction(raw);
  const context = readDiscordInteraction(raw, "");
  if (!parsed || !context.interactionId || !context.userId) {
    await updateDiscordEphemeralResponse(
      raw,
      recoveryErrorCard("Não foi possível validar esta oferta."),
    );
    return false;
  }

  try {
    const repository = new SupabaseLeadRecoveryRepository();
    const finalization = await repository.finalize({
      offerId: parsed.offerId,
      buyerDiscordId: context.userId,
      accepted: parsed.accepted,
      decisionInteractionId: context.interactionId,
    });

    if (finalization.decisionConflict) {
      await updateDiscordEphemeralResponse(
        raw,
        recoveryErrorCard("Esta oferta já recebeu outra decisão."),
      );
      return false;
    }
    if (finalization.expired || finalization.invalidated) {
      await updateDiscordEphemeralResponse(
        raw,
        recoveryErrorCard(
          "Esta oferta expirou ou o pedido original mudou. Abra a loja para montar um novo carrinho.",
        ),
      );
      return false;
    }
    if (finalization.declined) {
      await updateDiscordEphemeralResponse(raw, recoveryDeclinedCard());
      return false;
    }
    if (finalization.outOfStock || !finalization.orderId) {
      await updateDiscordEphemeralResponse(
        raw,
        recoveryErrorCard(
          "O carrinho não tem estoque suficiente agora. Você pode tentar novamente enquanto a oferta estiver válida.",
        ),
      );
      return false;
    }

    const payment = await new LivePixPaymentService(
      new SupabaseLivePixPaymentRepository(),
      getLivePixClient(),
    ).createCheckout(finalization.orderId, getSiteUrl());
    const purchase = await new SupabaseBotCommerceRepository().findPurchaseById(
      finalization.orderId,
    );
    if (!purchase) {
      throw new Error("Pedido recuperado não encontrado.");
    }

    await updateDiscordEphemeralResponse(
      raw,
      cartPurchaseResultCard(
        {
          kind: finalization.created ? "created" : "duplicate",
          orderId: purchase.id,
          items: purchase.items,
          subtotalPriceCents: purchase.subtotalPriceCents,
          totalPriceCents: purchase.salePriceCents,
          discountBps: purchase.discountBps,
          discountAmountCents: purchase.discountAmountCents,
          discountReason: purchase.discountReason,
          upsellProductId: purchase.upsellProductId,
          upsellDiscountBps: purchase.upsellDiscountBps,
          upsellDiscountAmountCents: purchase.upsellDiscountAmountCents,
          leadRecoveryDiscountBps: purchase.leadRecoveryDiscountBps,
          leadRecoveryDiscountAmountCents:
            purchase.leadRecoveryDiscountAmountCents,
        },
        payment.checkoutUrl,
        customization,
      ),
    );
    return finalization.created;
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[lead-recovery:decision] ${message}`);
    await updateDiscordEphemeralResponse(
      raw,
      recoveryErrorCard(
        "Não foi possível gerar o novo Pix agora. Tente novamente em instantes.",
      ),
    );
    return false;
  }
}

async function sendLeadRecoveryDm(
  claim: LeadRecoveryDeliveryClaim,
  fetcher: typeof fetch,
) {
  const channel = await discordBotJson<{ id?: unknown }>(
    "/users/@me/channels",
    {
      method: "POST",
      body: JSON.stringify({ recipient_id: claim.buyerDiscordId }),
    },
    fetcher,
  );
  if (typeof channel.id !== "string" || !/^[0-9]{15,22}$/.test(channel.id)) {
    throw new Error("Discord não retornou um canal privado válido.");
  }

  const card = toCardElement(leadRecoveryOfferCard(claim));
  if (!card) throw new Error("Mensagem de recuperação inválida.");
  const payload = cardToDiscordPayload(card, {
    contentFormat: DiscordContentFormat.ComponentsV2,
  });
  const message = await discordBotJson<{ id?: unknown }>(
    `/channels/${channel.id}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        nonce: claim.id.replaceAll("-", "").slice(0, 25),
        enforce_nonce: true,
        allowed_mentions: { parse: [] },
      }),
    },
    fetcher,
  );
  if (typeof message.id !== "string" || !/^[0-9]{15,22}$/.test(message.id)) {
    throw new Error("Discord não confirmou a mensagem privada.");
  }
  return { channelId: channel.id, messageId: message.id };
}

export function leadRecoveryOfferCard(
  claim: LeadRecoveryDeliveryClaim,
): ChatElement {
  const savings = claim.originalSalePriceCents - claim.recoveredSalePriceCents;
  const expiryTimestamp = Math.floor(Date.parse(claim.expiresAt) / 1_000);
  return (
    <Card
      title="💜 Seu carrinho ainda está disponível"
      subtitle="Criamos uma condição exclusiva para você concluir o pedido."
    >
      {claim.items.map((item) => (
        <CardText key={item.productId}>
          **{item.quantity}x {item.productName}**
        </CardText>
      ))}
      <Divider />
      <CardText>
        De ~~{formatBrl(claim.originalSalePriceCents)}~~ por **{formatBrl(claim.recoveredSalePriceCents)}**
      </CardText>
      <CardText>
        **{formatPercentage(claim.discountBps)} de desconto adicional** • economia de **{formatBrl(savings)}**
      </CardText>
      <CardText>
        O desconto foi aplicado depois dos benefícios que já existiam no carrinho.
      </CardText>
      <Divider />
      <CardText>
        O QR antigo expirou e não deve ser pago. Ao recuperar, um **novo QR Pix com o novo valor** será gerado aqui no privado.
      </CardText>
      <CardText>
        Oferta válida até &lt;t:{expiryTimestamp}:F&gt;. Estoque confirmado somente no clique.
      </CardText>
      <Actions>
        <Button id={ACCEPT_ACTION} value={claim.id} style="primary">
          Recuperar pedido
        </Button>
        <Button id={DECLINE_ACTION} value={claim.id} style="default">
          Não quero
        </Button>
      </Actions>
    </Card>
  );
}

function recoveryDeclinedCard(): ChatElement {
  return (
    <Card title="Oferta encerrada">
      <CardText>
        Tudo bem — este carrinho não será recuperado e o benefício não poderá ser reutilizado.
      </CardText>
    </Card>
  );
}

function recoveryErrorCard(message: string): ChatElement {
  return (
    <Card title="Não foi possível recuperar o pedido">
      <CardText>{message}</CardText>
    </Card>
  );
}

function formatBrl(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatPercentage(bps: number) {
  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(bps / 100)}%`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
