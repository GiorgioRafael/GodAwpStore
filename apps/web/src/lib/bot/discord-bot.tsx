/** @jsxImportSource chat */
import "server-only";

import {
  cardToDiscordPayload,
  decodeDiscordCustomId,
  DiscordAdapter,
  DiscordContentFormat,
  DiscordInteractionResponseFlag,
} from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  Actions,
  Button,
  Card,
  CardText,
  Chat,
  Divider,
  LinkButton,
  Select,
  SelectOption,
  toCardElement,
  type ChatElement,
  type AdapterPostableMessage,
} from "chat";

import { getSiteUrl } from "@/lib/env";
import { getLivePixClient } from "@/lib/livepix/client";
import {
  LIVEPIX_MINIMUM_BRL_CENTS,
  MAXIMUM_ORDER_QUANTITY,
  minimumLivePixQuantity,
} from "@/lib/livepix/limits";
import { LivePixPaymentService } from "@/lib/livepix/payment-service";
import { SupabaseLivePixPaymentRepository } from "@/lib/livepix/supabase-repository";
import { BotCommerceService } from "./commerce-service";
import { fetchDiscordGuildIdentity, readDiscordInteraction } from "./discord-context";
import { encodeDiscordCartSelection } from "./discord-cart-selection";
import {
  DISCORD_STOREFRONT_PRODUCT_LIMIT,
  type DiscordProductEmoji,
} from "./discord-product-emoji-shared";
import {
  botMessageLines,
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  interpolateBotMessage,
  interpolateBotMessageLimited,
  type BotMessageCustomization,
} from "./message-customization";
import { loadBotMessageCustomization } from "./message-customization-server";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import type {
  BotCatalogGame,
  BotCatalogProduct,
  BotCatalogSubstore,
  BotCommerceRepository,
  CartPurchaseResult,
  PurchaseResult,
} from "./types";

const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_MODAL_SUBMIT = 5;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_MODAL_RESPONSE = 9;
const QUANTITY_MODAL_PREFIX = "gwstore_quantity:";
const UNPAID_ORDER_EXPIRATION_NOTICE =
  "⏰ **Atenção:** pedidos não pagos são cancelados automaticamente após **2 horas**, e o estoque reservado é restabelecido.";

let botSingleton: ReturnType<typeof createBot> | undefined;

export function getDiscordBot() {
  botSingleton ??= createBot();
  return botSingleton;
}

function createBot() {
  const service = new BotCommerceService(new SupabaseBotCommerceRepository());
  const discord = new GWStoreDiscordAdapter({
    contentFormat: DiscordContentFormat.ComponentsV2,
    interactionFlags: ({ command }) =>
      command === "/loja" || command === "/ajuda"
        ? DiscordInteractionResponseFlag.Ephemeral
        : undefined,
  });
  const bot = new Chat({
    userName: "gwstore",
    adapters: { discord },
    state: createMemoryState(),
    dedupeTtlMs: 15 * 60 * 1000,
    fallbackStreamingPlaceholderText: null,
  });

  bot.onSlashCommand("/ajuda", async (event) => {
    await event.channel.post(helpCard(await loadBotMessageCustomization()));
  });

  bot.onSlashCommand("/loja", async (event) => {
    let customization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION;
    try {
      const context = readDiscordInteraction(event.raw, event.user.userId);
      const registrationTask = context.guildId
        ? fetchDiscordGuildIdentity(context.guildId)
            .then((identity) => service.registerGuild(identity))
            .catch((error) => {
              logBotError("guild_registration", error);
              return null;
            })
        : Promise.resolve(null);
      const [catalog, loadedCustomization] = await Promise.all([
        service.listCatalog(),
        loadBotMessageCustomization(),
        registrationTask,
      ]);
      customization = loadedCustomization;
      const cards = catalogCards(catalog, customization);
      for (const card of cards) await event.channel.post(card);
    } catch (error) {
      logBotError("catalog", error);
      await event.channel.post(
        errorCard(customization.error.storeUnavailable, customization),
      );
    }
  });

  bot.onAction("select_product", async (event) => {
    let customization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION;
    try {
      const [catalog, loadedCustomization] = await Promise.all([
        service.listCatalog(),
        loadBotMessageCustomization(),
      ]);
      customization = loadedCustomization;
      const selected = findCatalogProduct(catalog, event.value);
      const card = selected
        ? selectedProductCard(selected, customization)
        : errorCard(customization.error.productUnavailable, customization);
      await replyPrivately(event.raw, card, () =>
        event.thread
          ? event.thread.postEphemeral(event.user, card, { fallbackToDM: true })
          : Promise.resolve(null),
      );
    } catch (error) {
      logBotError("product_selection", error);
      const card = errorCard(
        customization.error.productLoadFailure,
        customization,
      );
      await replyPrivately(event.raw, card, () =>
        event.thread
          ? event.thread.postEphemeral(event.user, card, { fallbackToDM: true })
          : Promise.resolve(null),
      );
    }
  });

  return bot;
}

class GWStoreDiscordAdapter extends DiscordAdapter {
  protected override buildMessagePayload(
    message: AdapterPostableMessage,
    options?: { clearContentForCard?: boolean },
  ) {
    const productOptionEmojis = collectDiscordProductOptionEmojis(message);
    const result = super.buildMessagePayload(message, options);
    configureDiscordProductEntrySelect(result.payload, productOptionEmojis);
    return result;
  }
}

export type NativeDiscordQuantityInteraction =
  | { kind: "open"; productId: string }
  | { kind: "submit"; response: Record<string, unknown> };

export function parseNativeDiscordQuantityInteraction(
  raw: unknown,
): NativeDiscordQuantityInteraction | null {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.type !== "number") return null;

  if (raw.type === DISCORD_MESSAGE_COMPONENT && typeof raw.data.custom_id === "string") {
    const decoded = decodeDiscordCustomId(raw.data.custom_id);
    if (decoded.actionId !== "choose_quantity") return null;
    const productId = parseQuantityButtonProductId(decoded.value);
    if (!productId) return null;

    return {
      kind: "open",
      productId,
    };
  }

  if (
    raw.type === DISCORD_MODAL_SUBMIT &&
    typeof raw.data.custom_id === "string" &&
    raw.data.custom_id.startsWith(QUANTITY_MODAL_PREFIX) &&
    UUID_PATTERN.test(raw.data.custom_id.slice(QUANTITY_MODAL_PREFIX.length))
  ) {
    return {
      kind: "submit",
      response: {
        type: DISCORD_DEFERRED_CHANNEL_MESSAGE,
        data: { flags: DISCORD_EPHEMERAL_FLAG },
      },
    };
  }

  return null;
}

export async function createNativeDiscordQuantityResponse(
  productId: string,
  repository: Pick<BotCommerceRepository, "findPurchasableProduct" | "countAvailableStock"> =
    new SupabaseBotCommerceRepository(),
  customization: BotMessageCustomization | Promise<BotMessageCustomization> =
    DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const [product, availableStock, resolvedCustomization] = await Promise.all([
    repository.findPurchasableProduct(productId),
    repository.countAvailableStock(productId),
    customization,
  ]);
  customization = resolvedCustomization;
  if (!product) {
    return discordEphemeralText(customization.quantity.unavailableText);
  }

  const minimumQuantity = minimumLivePixQuantity(product.minimumPriceCents);
  if (!minimumQuantity) {
    return discordEphemeralText(customization.quantity.invalidPriceText);
  }
  if (availableStock < minimumQuantity) {
    return discordEphemeralText(
      interpolateBotMessage(customization.quantity.insufficientStockText, {
        minimum_quantity: minimumQuantity,
      }),
    );
  }

  return {
    type: DISCORD_MODAL_RESPONSE,
    data: {
      custom_id: `${QUANTITY_MODAL_PREFIX}${product.id}`,
      title: interpolateBotMessageLimited(customization.quantity.modalTitle, {}, 45),
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "quantity",
              label: interpolateBotMessageLimited(
                customization.quantity.inputLabel,
                { minimum_quantity: minimumQuantity },
                45,
              ),
              style: 1,
              min_length: 1,
              max_length: String(MAXIMUM_ORDER_QUANTITY).length,
              required: true,
              value: String(minimumQuantity),
              placeholder: interpolateBotMessageLimited(
                customization.quantity.inputPlaceholder,
                {
                  minimum_quantity: minimumQuantity,
                  maximum_quantity: MAXIMUM_ORDER_QUANTITY,
                },
                100,
              ),
            },
          ],
        },
      ],
    },
  };
}

export async function completeDiscordQuantityPurchase(
  raw: unknown,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  let card: ChatElement;
  let stockChanged = false;
  try {
    const context = readDiscordInteraction(raw, "");
    const productId = readQuantityModalProductId(raw);
    const quantity = readQuantityModalValue(raw);
    if (!context.interactionId || !context.guildId || !context.userId || !productId) {
      card = errorCard(
        customization.error.outsideServer,
        customization,
      );
    } else {
      const service = new BotCommerceService(new SupabaseBotCommerceRepository());
      const result = await service.purchase({
        interactionId: context.interactionId,
        buyerDiscordId: context.userId,
        productId,
        quantity,
        isServerBooster: context.isServerBooster,
        guild: await fetchDiscordGuildIdentity(context.guildId),
      });
      stockChanged = result.kind === "created";
      const checkoutUrl =
        result.kind === "created" || result.kind === "duplicate"
          ? (
              await new LivePixPaymentService(
                new SupabaseLivePixPaymentRepository(),
                getLivePixClient(),
              ).createCheckout(result.orderId, getSiteUrl())
            ).checkoutUrl
          : null;
      card = purchaseResultCard(result, checkoutUrl, customization);
    }
  } catch (error) {
    logBotError("purchase", error);
    card = errorCard(
      customization.error.purchaseFailure,
      customization,
    );
  }

  await updateDiscordEphemeralResponse(raw, card);
  return stockChanged;
}

export function catalogCards(
  catalog: BotCatalogGame[],
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
): ChatElement[] {
  const products = flattenCatalog(catalog);
  const message = customization.storefront;

  if (!products.length) {
    return [
      <Card
        key="empty-catalog"
        title={interpolateBotMessageLimited(message.emptyTitle, {}, 256)}
      >
        {message.emptyText ? <CardText>{message.emptyText}</CardText> : null}
        {message.emptyHint ? <CardText>{message.emptyHint}</CardText> : null}
      </Card>,
    ];
  }

  if (products.length > DISCORD_STOREFRONT_PRODUCT_LIMIT) {
    throw new Error(
      `A vitrine do Discord aceita no máximo ${DISCORD_STOREFRONT_PRODUCT_LIMIT} produtos ativos.`,
    );
  }

  const storefrontImageUrl = discordImageUrl(catalog[0]?.substores[0]?.imageUrl);
  return [
    <Card
      key="catalog"
      title={interpolateBotMessageLimited(message.title, {}, 256)}
      subtitle={interpolateBotMessageLimited(message.subtitle, {}, 256)}
      imageUrl={storefrontImageUrl ?? undefined}
    >
      {message.welcome ? <CardText>{message.welcome}</CardText> : null}
      {message.catalogText ? <CardText>{message.catalogText}</CardText> : null}
      {message.privacyText ? <CardText>{message.privacyText}</CardText> : null}
      {message.paymentText ? <CardText>{message.paymentText}</CardText> : null}
      <Divider />
      {message.prompt ? <CardText>{message.prompt}</CardText> : null}
      <Actions>
        <Select
          id="select_products"
          label={interpolateBotMessageLimited(message.selectLabel, {}, 100)}
          placeholder={interpolateBotMessageLimited(message.selectPlaceholder, {}, 150)}
        >
          {products.map(({ product }) => (
            <SelectOption
              key={product.id}
              {...discordSelectOptionMetadata(product.discordEmoji)}
              label={truncateSelectText(product.name)}
              value={encodeDiscordCartSelection(product.id, product.name)}
              description={truncateSelectText(
                `Preço: ${formatBrl(product.priceCents)} | Estoque: ${formatStockCount(product.availableStock)}`,
              )}
            />
          ))}
        </Select>
      </Actions>
    </Card>
  ];
}

function helpCard(
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const message = customization.help;
  return (
    <Card
      title={interpolateBotMessageLimited(message.title, {}, 256)}
      subtitle={
        message.subtitle
          ? interpolateBotMessageLimited(message.subtitle, {}, 256)
          : undefined
      }
    >
      {botMessageLines(message.body).map((line, index) =>
        line === "---" ? (
          <Divider key={`help-divider-${index}`} />
        ) : (
          <CardText key={`help-line-${index}`}>{line}</CardText>
        ),
      )}
    </Card>
  );
}

type CatalogSelection = {
  game: BotCatalogGame;
  substore: BotCatalogSubstore;
  product: BotCatalogProduct;
};

export function selectedProductCard(
  { game, substore, product }: CatalogSelection,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const emoji = productEmoji(product.name);
  const message = customization.product;
  const minimumQuantity = minimumLivePixQuantity(product.priceCents);
  const minimumTotalCents = minimumQuantity ? product.priceCents * minimumQuantity : 0;
  const canBuy =
    minimumQuantity !== null &&
    product.availableStock >= minimumQuantity &&
    minimumTotalCents >= LIVEPIX_MINIMUM_BRL_CENTS;
  return (
    <Card
      title={interpolateBotMessageLimited(
        message.title,
        { product_emoji: emoji, product_name: product.name },
        256,
      )}
      subtitle={interpolateBotMessageLimited(
        message.subtitle,
        { game_name: game.name, substore_title: substore.title },
        256,
      )}
      imageUrl={substore.imageUrl ?? undefined}
    >
      {message.selectedText ? <CardText>{message.selectedText}</CardText> : null}
      {product.description ? (
        <CardText>{interpolateBotMessageLimited(product.description, {}, 1_000)}</CardText>
      ) : null}
      <Divider />
      {message.priceText ? (
        <CardText>
          {interpolateBotMessage(message.priceText, { price: formatBrl(product.priceCents) })}
        </CardText>
      ) : null}
      {message.stockText ? (
        <CardText>
          {interpolateBotMessage(message.stockText, { stock: stockLabel(product.availableStock) })}
        </CardText>
      ) : null}
      {minimumQuantity ? (
        message.minimumText ? (
          <CardText>
            {renderMinimumText(message.minimumText, minimumQuantity, minimumTotalCents)}
          </CardText>
        ) : null
      ) : (
        message.invalidPriceText ? <CardText>{message.invalidPriceText}</CardText> : null
      )}
      {message.deliveryText ? <CardText>{message.deliveryText}</CardText> : null}
      {message.privacyText ? <CardText>{message.privacyText}</CardText> : null}
      <Divider />
      {!minimumQuantity ? null : canBuy ? (
        <Actions>
          <Button id="choose_quantity" value={product.id} style="primary">
            {interpolateBotMessageLimited(message.buttonLabel, {}, 80)}
          </Button>
        </Actions>
      ) : product.availableStock > 0 ? (
        message.insufficientStockText ? (
          <CardText>
            {interpolateBotMessage(message.insufficientStockText, {
              minimum_quantity: minimumQuantity,
            })}
          </CardText>
        ) : null
      ) : (
        message.outOfStockText ? <CardText>{message.outOfStockText}</CardText> : null
      )}
    </Card>
  );
}

function flattenCatalog(catalog: BotCatalogGame[]): CatalogSelection[] {
  return catalog.flatMap((game) =>
    game.substores.flatMap((substore) =>
      substore.products.map((product) => ({ game, substore, product })),
    ),
  ).sort((left, right) =>
    left.product.sortOrder - right.product.sortOrder ||
    left.product.name.localeCompare(right.product.name, "pt-BR"),
  );
}

function findCatalogProduct(catalog: BotCatalogGame[], productId: string | undefined) {
  if (!productId) return null;
  return flattenCatalog(catalog).find(({ product }) => product.id === productId) ?? null;
}

export async function postDiscordEphemeral(
  raw: unknown,
  card: ChatElement,
  fetcher: typeof fetch = fetch,
) {
  const interaction = readDiscordFollowupContext(raw);
  const normalizedCard = toCardElement(card);
  if (!normalizedCard) throw new Error("Resposta privada Discord inválida.");
  const payload = configureDiscordProductEntrySelect(
    cardToDiscordPayload(normalizedCard, {
      contentFormat: DiscordContentFormat.ComponentsV2,
    }),
  );
  const apiUrl = (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(/\/$/, "");
  const response = await fetcher(
    `${apiUrl}/webhooks/${interaction.applicationId}/${interaction.token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        flags: (payload.flags ?? 0) | DISCORD_EPHEMERAL_FLAG,
        allowed_mentions: { parse: [] },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Discord recusou a resposta privada (${response.status}).`);
  }
}

export async function updateDiscordEphemeralResponse(
  raw: unknown,
  card: ChatElement,
  fetcher: typeof fetch = fetch,
) {
  const interaction = readDiscordFollowupContext(raw);
  const normalizedCard = toCardElement(card);
  if (!normalizedCard) throw new Error("Resposta privada Discord inválida.");
  const payload = cardToDiscordPayload(normalizedCard, {
    contentFormat: DiscordContentFormat.ComponentsV2,
  });
  const apiUrl = (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(/\/$/, "");
  const response = await fetcher(
    `${apiUrl}/webhooks/${interaction.applicationId}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        allowed_mentions: { parse: [] },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Discord recusou a atualização privada (${response.status}).`);
  }
}

function readDiscordFollowupContext(raw: unknown) {
  if (!isObject(raw)) throw new Error("Interação Discord inválida.");
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const applicationId = typeof raw.application_id === "string" ? raw.application_id : "";
  const token = typeof raw.token === "string" ? raw.token : "";
  if (
    !configuredApplicationId ||
    applicationId !== configuredApplicationId ||
    !/^[0-9]{15,22}$/.test(applicationId) ||
    !/^[A-Za-z0-9._-]{20,500}$/.test(token)
  ) {
    throw new Error("Interação Discord incompleta.");
  }
  return { applicationId, token };
}

async function replyPrivately(raw: unknown, card: ChatElement, fallback: () => Promise<unknown>) {
  try {
    await postDiscordEphemeral(raw, card);
  } catch (error) {
    logBotError("private_reply", error);
    await fallback();
  }
}

export function purchaseResultCard(
  result: PurchaseResult,
  checkoutUrl: string | null = null,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const message = customization.order;
  if (result.kind === "created" || result.kind === "duplicate") {
    return (
      <Card
        title={
          result.kind === "created"
            ? interpolateBotMessageLimited(message.createdTitle, {}, 256)
            : interpolateBotMessageLimited(message.duplicateTitle, {}, 256)
        }
        subtitle={interpolateBotMessageLimited(message.subtitle, {}, 256)}
      >
        {message.productLabel ? <CardText>{message.productLabel}</CardText> : null}
        <CardText>
          {productEmoji(result.productName)} **{result.productName}** • 🔢 **{result.quantity} unidade{result.quantity === 1 ? "" : "s"}**
        </CardText>
        {message.unitPriceLabel ? (
          <CardText>{message.unitPriceLabel} {formatBrl(result.unitPriceCents)}</CardText>
        ) : null}
        {result.discountReason === "server_booster" && message.subtotalLabel ? (
          <CardText>{message.subtotalLabel} {formatBrl(result.subtotalPriceCents)}</CardText>
        ) : null}
        {result.discountReason === "server_booster" && message.discountLabel ? (
          <CardText>
            {interpolateBotMessage(message.discountLabel, {
              discount_percent: formatPercentage(result.discountBps),
            })} -{formatBrl(result.discountAmountCents)}
          </CardText>
        ) : null}
        {message.totalLabel ? (
          <CardText>{message.totalLabel} **{formatBrl(result.totalPriceCents)}**</CardText>
        ) : null}
        {message.orderIdLabel ? (
          <CardText>{message.orderIdLabel} `{result.orderId}`</CardText>
        ) : null}
        <Divider />
        {message.statusText ? <CardText>{message.statusText}</CardText> : null}
        <CardText>{UNPAID_ORDER_EXPIRATION_NOTICE}</CardText>
        {message.paymentPrompt ? <CardText>{message.paymentPrompt}</CardText> : null}
        {checkoutUrl ? (
          <Actions>
            <LinkButton url={checkoutUrl}>
              {interpolateBotMessageLimited(message.paymentButtonLabel, {}, 80)}
            </LinkButton>
          </Actions>
        ) : null}
        <Divider />
        {message.ticketText ? <CardText>{message.ticketText}</CardText> : null}
        {message.privacyText ? <CardText>{message.privacyText}</CardText> : null}
        {message.protectedText ? <CardText>{message.protectedText}</CardText> : null}
      </Card>
    );
  }

  const errorMessage = {
    invalid_request: customization.error.invalidRequest,
    invalid_quantity: interpolateBotMessage(customization.error.invalidQuantity, {
      maximum_quantity: MAXIMUM_ORDER_QUANTITY,
    }),
    guild_not_authorized: customization.error.guildNotAuthorized,
    product_unavailable: customization.error.productUnavailable,
    out_of_stock: customization.error.outOfStock,
    insufficient_stock: interpolateBotMessage(customization.error.insufficientStock, {
      available_stock: result.kind === "insufficient_stock" ? result.availableStock : 0,
    }),
    quantity_below_minimum: interpolateBotMessage(customization.error.quantityBelowMinimum, {
      minimum_pix: formatBrl(LIVEPIX_MINIMUM_BRL_CENTS),
      minimum_quantity: result.kind === "quantity_below_minimum" ? result.minimumQuantity : 0,
      minimum_total:
        result.kind === "quantity_below_minimum"
          ? formatBrl(result.minimumTotalCents)
          : formatBrl(0),
    }),
    interaction_conflict: customization.error.interactionConflict,
  }[result.kind];
  return errorCard(errorMessage, customization);
}

export function cartPurchaseResultCard(
  result: CartPurchaseResult,
  checkoutUrl: string | null = null,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  const message = customization.order;
  if (result.kind === "created" || result.kind === "duplicate") {
    return (
      <Card
        title={
          result.kind === "created"
            ? interpolateBotMessageLimited(message.createdTitle, {}, 256)
            : interpolateBotMessageLimited(message.duplicateTitle, {}, 256)
        }
        subtitle={interpolateBotMessageLimited(message.subtitle, {}, 256)}
      >
        {message.productLabel ? <CardText>{message.productLabel}</CardText> : null}
        {result.items.map((item) => (
          <CardText key={item.productId}>
            {productEmoji(item.productName)} **{item.productName}** • 🔢 **{item.quantity} unidade{item.quantity === 1 ? "" : "s"}** • {formatBrl(item.totalPriceCents)}
          </CardText>
        ))}
        {result.discountReason === "server_booster" && message.subtotalLabel ? (
          <CardText>{message.subtotalLabel} {formatBrl(result.subtotalPriceCents)}</CardText>
        ) : null}
        {result.discountReason === "server_booster" && message.discountLabel ? (
          <CardText>
            {interpolateBotMessage(message.discountLabel, {
              discount_percent: formatPercentage(result.discountBps),
            })} -{formatBrl(result.discountAmountCents)}
          </CardText>
        ) : null}
        {message.totalLabel ? (
          <CardText>{message.totalLabel} **{formatBrl(result.totalPriceCents)}**</CardText>
        ) : null}
        {message.orderIdLabel ? (
          <CardText>{message.orderIdLabel} `{result.orderId}`</CardText>
        ) : null}
        <Divider />
        {message.statusText ? <CardText>{message.statusText}</CardText> : null}
        <CardText>{UNPAID_ORDER_EXPIRATION_NOTICE}</CardText>
        {message.paymentPrompt ? <CardText>{message.paymentPrompt}</CardText> : null}
        {checkoutUrl ? (
          <Actions>
            <LinkButton url={checkoutUrl}>
              {interpolateBotMessageLimited(message.paymentButtonLabel, {}, 80)}
            </LinkButton>
          </Actions>
        ) : null}
        <Divider />
        {message.ticketText ? <CardText>{message.ticketText}</CardText> : null}
        {message.privacyText ? <CardText>{message.privacyText}</CardText> : null}
        {message.protectedText ? <CardText>{message.protectedText}</CardText> : null}
      </Card>
    );
  }

  if (result.kind === "total_below_minimum") {
    return errorCard(
      `O total do carrinho precisa ser de pelo menos **${formatBrl(result.minimumTotalCents)}** para pagar via Pix.`,
      customization,
    );
  }
  if (result.kind === "insufficient_stock") {
    return errorCard(
      `Estoque insuficiente para **${result.productName}**. Disponível agora: **${result.availableStock}**.`,
      customization,
    );
  }

  const errorMessage = {
    invalid_request: customization.error.invalidRequest,
    invalid_quantity: interpolateBotMessage(customization.error.invalidQuantity, {
      maximum_quantity: MAXIMUM_ORDER_QUANTITY,
    }),
    guild_not_authorized: customization.error.guildNotAuthorized,
    product_unavailable: customization.error.productUnavailable,
    out_of_stock: customization.error.outOfStock,
    interaction_conflict: customization.error.interactionConflict,
  }[result.kind];
  return errorCard(errorMessage, customization);
}

export function configureDiscordProductEntrySelect<T>(
  payload: T,
  productOptionEmojis: ReadonlyMap<string, DiscordProductEmoji> = new Map(),
): T {
  visitDiscordComponents(payload, (component) => {
    if (
      component.type !== 3 ||
      typeof component.custom_id !== "string" ||
      decodeDiscordCustomId(component.custom_id).actionId !== "select_products" ||
      !Array.isArray(component.options)
    ) {
      return;
    }

    component.min_values = 1;
    component.max_values = 1;
    for (const option of component.options) {
      if (!isObject(option) || typeof option.value !== "string") continue;
      const emoji = productOptionEmojis.get(option.value);
      if (emoji) option.emoji = emoji;
    }
  });
  return payload;
}

export function collectDiscordProductOptionEmojis(value: unknown) {
  const emojis = new Map<string, DiscordProductEmoji>();
  visitRawChatElements(value, (element) => {
    if (!isObject(element.props)) return;
    const optionValue = element.props.value;
    const emoji = element.props.discordEmoji;
    if (typeof optionValue === "string" && isDiscordProductEmoji(emoji)) {
      emojis.set(optionValue, emoji);
    }
  });
  return emojis;
}

function discordSelectOptionMetadata(emoji: DiscordProductEmoji | null | undefined) {
  return emoji ? { discordEmoji: emoji } : {};
}

function isDiscordProductEmoji(value: unknown): value is DiscordProductEmoji {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    /^[0-9]{15,22}$/.test(value.id) &&
    typeof value.name === "string" &&
    /^[A-Za-z0-9_]{2,32}$/.test(value.name) &&
    value.animated === false
  );
}

function visitRawChatElements(
  value: unknown,
  visit: (element: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) visitRawChatElements(item, visit);
    return;
  }
  if (!isObject(value)) return;
  visit(value);
  visitRawChatElements(value.children, visit);
}

function errorCard(
  message: string,
  customization: BotMessageCustomization = DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
) {
  return (
    <Card
      title={interpolateBotMessageLimited(customization.error.title, {}, 256)}
      subtitle={
        customization.error.subtitle
          ? interpolateBotMessageLimited(customization.error.subtitle, {}, 256)
          : undefined
      }
    >
      <CardText>{message}</CardText>
      {customization.error.retryText ? (
        <CardText>{customization.error.retryText}</CardText>
      ) : null}
    </Card>
  );
}

function formatBrl(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatPercentage(bps: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(bps / 100) + "%";
}

function renderMinimumText(template: string, quantity: number, totalCents: number) {
  return interpolateBotMessage(template, {
    minimum_quantity: quantity,
    minimum_total: formatBrl(totalCents),
  }).replaceAll("unidade(s)", quantity === 1 ? "unidade" : "unidades");
}

function stockLabel(availableStock: number) {
  return availableStock === 1
    ? "1 unidade"
    : `${new Intl.NumberFormat("pt-BR").format(availableStock)} unidades`;
}

function formatStockCount(availableStock: number) {
  return new Intl.NumberFormat("pt-BR").format(availableStock);
}

function discordImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function productEmoji(productName: string) {
  const normalized = productName.toLocaleLowerCase("en-US");
  if (normalized.includes("super watering")) return "💦🌈";
  if (normalized.includes("super sprinkler")) return "🌧️💜";
  if (normalized.includes("sun bloom") || normalized.includes("sunbloom")) return "🌻☀️";
  if (normalized.includes("dragon") && normalized.includes("breath")) return "🐉🔥";
  if (normalized.includes("ghost pepper")) return "🌶️👻";
  if (normalized.includes("moon bloom") || normalized.includes("moon blossom")) return "🌙🌸";
  if (normalized.includes("venom")) return "🕷️🧪";
  if (normalized.includes("hypno")) return "🌀🌺";
  if (normalized.includes("serpent")) return "🐍❄️";
  if (normalized.includes("unicórnio") || normalized.includes("unicorn")) return "🦄🌈";
  if (normalized.includes("dragonfly")) return "🧚✨";
  if (normalized.includes("raccoon")) return "🦝🌟";
  if (normalized.includes("sheckles")) return "💵💰";
  return "🎁✨";
}

function truncateSelectText(text: string) {
  return text.length <= 100 ? text : `${text.slice(0, 97)}...`;
}

function parseQuantityButtonProductId(value: string | undefined) {
  if (!value) return null;
  const separator = value.lastIndexOf(":");
  const productId = separator > 0 ? value.slice(0, separator) : value;
  return UUID_PATTERN.test(productId) ? productId : null;
}

function discordEphemeralText(content: string) {
  return {
    type: 4,
    data: {
      content,
      flags: DISCORD_EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
    },
  };
}

function readQuantityModalProductId(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.data) || typeof raw.data.custom_id !== "string") return null;
  if (!raw.data.custom_id.startsWith(QUANTITY_MODAL_PREFIX)) return null;
  const productId = raw.data.custom_id.slice(QUANTITY_MODAL_PREFIX.length);
  return UUID_PATTERN.test(productId) ? productId : null;
}

function readQuantityModalValue(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.data) || !Array.isArray(raw.data.components)) return Number.NaN;
  for (const row of raw.data.components) {
    if (!isObject(row) || !Array.isArray(row.components)) continue;
    for (const component of row.components) {
      if (
        isObject(component) &&
        component.custom_id === "quantity" &&
        typeof component.value === "string" &&
        /^\d{1,5}$/.test(component.value.trim())
      ) {
        return Number(component.value.trim());
      }
    }
  }
  return Number.NaN;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function visitDiscordComponents(
  value: unknown,
  visit: (component: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) visitDiscordComponents(item, visit);
    return;
  }
  if (!isObject(value)) return;
  if (typeof value.type === "number") visit(value);
  for (const child of Object.values(value)) visitDiscordComponents(child, visit);
}

function logBotError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-bot:${operation}] ${message}`);
}
