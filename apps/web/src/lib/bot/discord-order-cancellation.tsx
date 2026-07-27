/** @jsxImportSource chat */
import "server-only";

import { decodeDiscordCustomId } from "@chat-adapter/discord";
import { Card, CardText, Divider, type ChatElement } from "chat";

import { BotCommerceService } from "./commerce-service";
import { deleteDiscordBotMessage } from "./discord-api";
import { createNativeDiscordCartResponse } from "./discord-cart";
import { readDiscordInteraction } from "./discord-context";
import { createDiscordStorefrontPayloads } from "./discord-storefront";
import {
  orderRebuildActions,
  updateDiscordEphemeralResponse,
} from "./discord-bot";
import type { BotMessageCustomization } from "./message-customization";
import { loadBotMessageCustomization } from "./message-customization-server";
import {
  type BuyerOrderCancellationResult,
  SupabaseOrderCancellationRepository,
} from "./order-cancellation-repository";
import { prepareDiscordCartQuantities } from "./discord-quantity-preparation";
import { SupabaseBotCommerceRepository } from "./supabase-repository";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_DEFERRED_UPDATE_MESSAGE = 6;
const DISCORD_UPDATE_MESSAGE = 7;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ORDER_CANCEL_ACTION = "gwstore_order_cancel";
export const ORDER_RETRY_QUANTITIES_ACTION = "gwstore_order_retry_quantities";
export const ORDER_NEW_CART_ACTION = "gwstore_order_new_cart";

export type NativeDiscordOrderCancellationInteraction =
  | { kind: "cancel"; orderId: string; response: { type: 6 } }
  | { kind: "retry_quantities"; orderId: string }
  | { kind: "new_cart"; orderId: string };

type OrderCancellationRepository = Pick<
  SupabaseOrderCancellationRepository,
  "cancel" | "loadRebuildSelections"
>;

export function parseNativeDiscordOrderCancellationInteraction(
  raw: unknown,
): NativeDiscordOrderCancellationInteraction | null {
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
  const kind = {
    [ORDER_CANCEL_ACTION]: "cancel",
    [ORDER_RETRY_QUANTITIES_ACTION]: "retry_quantities",
    [ORDER_NEW_CART_ACTION]: "new_cart",
  }[decoded.actionId] as
    | NativeDiscordOrderCancellationInteraction["kind"]
    | undefined;
  const orderId =
    typeof decoded.value === "string" ? decoded.value.trim().toLowerCase() : "";
  if (!kind || !UUID_PATTERN.test(orderId)) return null;

  return kind === "cancel"
    ? {
        kind,
        orderId,
        response: { type: DISCORD_DEFERRED_UPDATE_MESSAGE },
      }
    : { kind, orderId };
}

export async function completeDiscordOrderCancellation(
  raw: unknown,
  repository: OrderCancellationRepository =
    new SupabaseOrderCancellationRepository(),
) {
  const parsed = parseNativeDiscordOrderCancellationInteraction(raw);
  const context = readDiscordInteraction(raw, "");
  if (
    !parsed ||
    parsed.kind !== "cancel" ||
    !context.guildId ||
    !context.userId
  ) {
    await updateDiscordEphemeralResponse(raw, orderCancellationUnavailableCard());
    return false;
  }

  try {
    const result = await repository.cancel({
      orderId: parsed.orderId,
      discordGuildId: context.guildId,
      buyerDiscordId: context.userId,
    });
    if (result.recoveryDm) {
      await deleteDiscordBotMessage(
        result.recoveryDm.channelId,
        result.recoveryDm.messageId,
      ).catch((error) => {
        const message =
          error instanceof Error ? error.message : "erro desconhecido";
        console.error(`[discord-order-cancellation:recovery-dm] ${message}`);
      });
    }
    await updateDiscordEphemeralResponse(
      raw,
      orderCancellationResultCard(result),
    );
    // Only historical orders can restore an encrypted-unit reservation.
    return result.kind === "cancelled" && result.stockChanged;
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-order-cancellation] ${message}`);
    await updateDiscordEphemeralResponse(raw, orderCancellationUnavailableCard());
    return false;
  }
}

export async function createNativeDiscordOrderRebuildResponse(
  raw: unknown,
  interaction: Extract<
    NativeDiscordOrderCancellationInteraction,
    { kind: "retry_quantities" | "new_cart" }
  >,
  dependencies: {
    cancellationRepository?: OrderCancellationRepository;
    commerceRepository?: SupabaseBotCommerceRepository;
    customization?: BotMessageCustomization;
  } = {},
) {
  try {
    const context = readDiscordInteraction(raw, "");
    if (!context.guildId || !context.userId) return rebuildUnavailableResponse();

    const cancellationRepository =
      dependencies.cancellationRepository ??
      new SupabaseOrderCancellationRepository();
    const selections = await cancellationRepository.loadRebuildSelections({
      orderId: interaction.orderId,
      discordGuildId: context.guildId,
      buyerDiscordId: context.userId,
    });
    if (!selections) return rebuildUnavailableResponse();

    if (interaction.kind === "retry_quantities") {
      const preparation = await prepareDiscordCartQuantities(
        raw,
        selections.map((selection) => selection.productId),
      );
      return createNativeDiscordCartResponse(selections, preparation);
    }

    const commerceRepository =
      dependencies.commerceRepository ?? new SupabaseBotCommerceRepository();
    const [catalog, customization] = await Promise.all([
      new BotCommerceService(commerceRepository).listCatalog(),
      dependencies.customization
        ? Promise.resolve(dependencies.customization)
        : loadBotMessageCustomization(),
    ]);
    const [payload] = createDiscordStorefrontPayloads(catalog, customization);
    return payload
      ? { type: DISCORD_UPDATE_MESSAGE, data: payload }
      : rebuildUnavailableResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-order-rebuild] ${message}`);
    return rebuildUnavailableResponse();
  }
}

export function orderCancellationResultCard(
  result: BuyerOrderCancellationResult,
): ChatElement {
  if (result.kind === "cancelled" || result.kind === "already_cancelled") {
    return (
      <Card
        title={
          result.kind === "cancelled"
            ? "Pedido cancelado"
            : "Este pedido já estava cancelado"
        }
        subtitle="O estoque não foi consumido."
      >
        <CardText>
          Não pague o QR anterior: ele não gera mais entrega automática.
        </CardText>
        <Divider />
        <CardText>
          Corrija somente as quantidades ou monte um carrinho diferente agora:
        </CardText>
        {orderRebuildActions(result.orderId)}
      </Card>
    );
  }

  if (result.kind === "payment_confirmed") {
    return (
      <Card
        title="Não é possível cancelar"
        subtitle="O pagamento deste pedido já foi confirmado."
      >
        <CardText>
          A entrega seguirá pelo ticket privado. Se houver algum engano, fale
          com a equipe da loja no próprio ticket.
        </CardText>
      </Card>
    );
  }

  return orderCancellationUnavailableCard();
}

function orderCancellationUnavailableCard(): ChatElement {
  return (
    <Card title="Não foi possível cancelar o pedido">
      <CardText>
        O pedido não pertence a esta conta, já foi processado ou não está mais
        disponível para cancelamento.
      </CardText>
    </Card>
  );
}

function rebuildUnavailableResponse() {
  return {
    type: DISCORD_UPDATE_MESSAGE,
    data: {
      content:
        "Não foi possível reabrir este carrinho. Use `/loja` para começar um novo pedido.",
      components: [],
      flags: DISCORD_EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
