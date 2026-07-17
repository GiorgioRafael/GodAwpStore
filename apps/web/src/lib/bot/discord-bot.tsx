/** @jsxImportSource chat */
import "server-only";

import {
  cardToDiscordPayload,
  createDiscordAdapter,
  decodeDiscordCustomId,
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
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import type {
  BotCatalogGame,
  BotCatalogProduct,
  BotCatalogSubstore,
  BotCommerceRepository,
  PurchaseResult,
} from "./types";

const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const DISCORD_SELECT_OPTION_LIMIT = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_MODAL_SUBMIT = 5;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_MODAL_RESPONSE = 9;
const QUANTITY_MODAL_PREFIX = "gwstore_quantity:";

let botSingleton: ReturnType<typeof createBot> | undefined;

export function getDiscordBot() {
  botSingleton ??= createBot();
  return botSingleton;
}

function createBot() {
  const service = new BotCommerceService(new SupabaseBotCommerceRepository());
  const discord = createDiscordAdapter({
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
    await event.channel.post(helpCard());
  });

  bot.onSlashCommand("/loja", async (event) => {
    try {
      const context = readDiscordInteraction(event.raw, event.user.userId);
      if (context.guildId) {
        try {
          await service.registerGuild(await fetchDiscordGuildIdentity(context.guildId));
        } catch (error) {
          logBotError("guild_registration", error);
        }
      }

      const cards = catalogCards(await service.listCatalog());
      for (const card of cards) await event.channel.post(card);
    } catch (error) {
      logBotError("catalog", error);
      await event.channel.post(
        errorCard("🛠️ A loja está se preparando agora. ✨ Tente novamente em alguns instantes! ⏳"),
      );
    }
  });

  bot.onAction("select_product", async (event) => {
    try {
      const selected = findCatalogProduct(await service.listCatalog(), event.value);
      const card = selected
        ? selectedProductCard(selected)
        : errorCard("🔎 Esse produto não está mais disponível no catálogo. 🛍️ Escolha outro item! ✨");
      await replyPrivately(event.raw, card, () =>
        event.thread
          ? event.thread.postEphemeral(event.user, card, { fallbackToDM: true })
          : Promise.resolve(null),
      );
    } catch (error) {
      logBotError("product_selection", error);
      const card = errorCard(
        "🛠️ Não conseguimos carregar esse produto agora. ✨ Tente novamente em alguns instantes! ⏳",
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
) {
  const [product, availableStock] = await Promise.all([
    repository.findPurchasableProduct(productId),
    repository.countAvailableStock(productId),
  ]);
  if (!product) {
    return discordEphemeralText("🔎🎁 Esse produto não está mais disponível. Abra a loja novamente com /loja.");
  }

  const minimumQuantity = minimumLivePixQuantity(product.minimumPriceCents);
  if (!minimumQuantity) {
    return discordEphemeralText("🚫💸 Este produto está sem um preço válido para pagamento.");
  }
  if (availableStock < minimumQuantity) {
    return discordEphemeralText(
      `⚠️📦 O estoque atual não alcança as ${minimumQuantity} unidades mínimas para gerar o Pix.`,
    );
  }

  return {
    type: DISCORD_MODAL_RESPONSE,
    data: {
      custom_id: `${QUANTITY_MODAL_PREFIX}${product.id}`,
      title: "Escolha a quantidade",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "quantity",
              label: `Quantidade (mínimo ${minimumQuantity})`,
              style: 1,
              min_length: 1,
              max_length: String(MAXIMUM_ORDER_QUANTITY).length,
              required: true,
              value: String(minimumQuantity),
              placeholder: `De ${minimumQuantity} até ${MAXIMUM_ORDER_QUANTITY}`,
            },
          ],
        },
      ],
    },
  };
}

export async function completeDiscordQuantityPurchase(raw: unknown) {
  let card: ChatElement;
  let stockChanged = false;
  try {
    const context = readDiscordInteraction(raw, "");
    const productId = readQuantityModalProductId(raw);
    const quantity = readQuantityModalValue(raw);
    if (!context.interactionId || !context.guildId || !context.userId || !productId) {
      card = errorCard(
        "🏰 A compra precisa ser iniciada dentro do servidor Discord usando o botão da loja. 🛍️",
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
      card = purchaseResultCard(result, checkoutUrl);
    }
  } catch (error) {
    logBotError("purchase", error);
    card = errorCard(
      "🛡️ Não foi possível criar o pedido. Fique tranquilo: nenhum item foi entregue ou revelado. 🔒",
    );
  }

  await updateDiscordEphemeralResponse(raw, card);
  return stockChanged;
}

export function catalogCards(catalog: BotCatalogGame[]): ChatElement[] {
  const products = flattenCatalog(catalog);

  if (!products.length) {
    return [
      <Card key="empty-catalog" title="🛍️✨ GWSTORE • LOJA OFICIAL ✨🛍️">
        <CardText>😴 Nosso catálogo está descansando e ainda não tem produtos ativos.</CardText>
        <CardText>🔔 Volte em breve para conferir as novidades! 💜</CardText>
      </Card>,
    ];
  }

  const pages = chunk(products, DISCORD_SELECT_OPTION_LIMIT);
  return pages.map((page, index) => (
    <Card
      key={`catalog-${index}`}
      title={
        pages.length > 1
          ? `🛍️✨ GWSTORE • PRODUTOS ${index + 1}/${pages.length} ✨🛍️`
          : "🛍️✨ GWSTORE • LOJA OFICIAL ✨🛍️"
      }
      subtitle="🌱 Grow a Garden 2 • ⚡ Compra rápida, privada e segura"
    >
      <CardText>👋💜 **Bem-vindo(a) à GWStore!** 💜👋</CardText>
      <CardText>🎮 Escolha seu produto favorito e prepare-se para turbinar sua conta! 🚀✨</CardText>
      <CardText>🔒 Somente **você** verá os detalhes, o pedido e o link de pagamento. 🛡️</CardText>
      <CardText>💠 Pagamento rápido e seguro via **Pix com LivePix**. ⚡✅</CardText>
      <Divider />
      <CardText>👇🛒 **Abra a lista abaixo e selecione seu produto:**</CardText>
      <Actions>
        <Select
          id="select_product"
          label="🛒 Catálogo de produtos"
          placeholder="✨ Clique aqui e escolha seu produto ✨"
        >
          {page.map(({ game, substore, product }) => (
            <SelectOption
              key={product.id}
              label={truncateSelectText(
                `${productEmoji(product.name)} ${product.name} • ${formatBrl(product.priceCents)}`,
              )}
              value={product.id}
              description={truncateSelectText(
                `🎮 ${game.name} • 🏪 ${substore.name} • 📦 ${stockLabel(product.availableStock)}`,
              )}
            />
          ))}
        </Select>
      </Actions>
    </Card>
  ));
}

function helpCard() {
  return (
    <Card title="🆘✨ AJUDA • GWSTORE ✨🆘" subtitle="💜 Comprar é rápido, privado e seguro!">
      <CardText>1️⃣ Vá até o canal da loja e abra a **lista de produtos**. 🛍️✨</CardText>
      <CardText>2️⃣ Escolha um produto no menu suspenso. 👇🎁</CardText>
      <CardText>3️⃣ Confira preço e estoque e clique em **🔢 Escolher quantidade**.</CardText>
      <CardText>4️⃣ Informe a quantidade; o total precisa atingir o mínimo de **R$ 1,00** da LivePix. 💠</CardText>
      <CardText>5️⃣ Pague com segurança pelo checkout da **LivePix**. 🔒✅</CardText>
      <CardText>6️⃣ Após a confirmação, abrimos um ticket privado com você e os administradores. 🎫👑</CardText>
      <Divider />
      <CardText>🔄 Não encontrou a vitrine? Digite **/loja** para abrir o catálogo alternativo.</CardText>
      <CardText>🛡️ Nenhum dado protegido do estoque é revelado antes da confirmação do pagamento.</CardText>
      <CardText>💬 Precisou de ajuda? Fale com a equipe no seu ticket! 🤝💜</CardText>
    </Card>
  );
}

type CatalogSelection = {
  game: BotCatalogGame;
  substore: BotCatalogSubstore;
  product: BotCatalogProduct;
};

export function selectedProductCard({ game, substore, product }: CatalogSelection) {
  const emoji = productEmoji(product.name);
  const minimumQuantity = minimumLivePixQuantity(product.priceCents);
  const minimumTotalCents = minimumQuantity ? product.priceCents * minimumQuantity : 0;
  const canBuy =
    minimumQuantity !== null &&
    product.availableStock >= minimumQuantity &&
    minimumTotalCents >= LIVEPIX_MINIMUM_BRL_CENTS;
  return (
    <Card
      title={`${emoji}✨ ${product.name} ✨${emoji}`}
      subtitle={`🎮 ${game.name} • 🏪 ${substore.title}`}
      imageUrl={substore.imageUrl ?? undefined}
    >
      <CardText>🎉 **Você escolheu um produto incrível!** 🎉</CardText>
      {product.description ? <CardText>{product.description}</CardText> : null}
      <Divider />
      <CardText>💰💠 **Preço por unidade:** {formatBrl(product.priceCents)}</CardText>
      <CardText>📦✅ **Estoque disponível:** {stockLabel(product.availableStock)}</CardText>
      {minimumQuantity ? (
        <CardText>
          ⚠️💠 **Mínimo da LivePix:** {minimumQuantity} unidade{minimumQuantity === 1 ? "" : "s"} • **{formatBrl(minimumTotalCents)}**
        </CardText>
      ) : (
        <CardText>🚫💸 Este produto está sem um preço válido para pagamento.</CardText>
      )}
      <CardText>🚀🎫 **Entrega:** atendimento manual em ticket privado após a confirmação.</CardText>
      <CardText>🔐🛡️ Seu pedido e seu pagamento ficam visíveis somente para você.</CardText>
      <Divider />
      {!minimumQuantity ? (
        <CardText>🚫💸 Corrija o preço deste produto no painel antes de tentar vender.</CardText>
      ) : canBuy ? (
        <Actions>
          <Button id="choose_quantity" value={product.id} style="primary">
            🔢 Escolher quantidade 🛒
          </Button>
        </Actions>
      ) : product.availableStock > 0 ? (
        <CardText>
          ⚠️📦 O estoque atual não alcança as **{minimumQuantity} unidades mínimas** exigidas para gerar um Pix.
        </CardText>
      ) : (
        <CardText>😔💨 **Produto esgotado no momento.** Volte em breve! 🔔✨</CardText>
      )}
    </Card>
  );
}

function flattenCatalog(catalog: BotCatalogGame[]): CatalogSelection[] {
  return catalog.flatMap((game) =>
    game.substores.flatMap((substore) =>
      substore.products.map((product) => ({ game, substore, product })),
    ),
  );
}

function findCatalogProduct(catalog: BotCatalogGame[], productId: string | undefined) {
  if (!productId) return null;
  return flattenCatalog(catalog).find(({ product }) => product.id === productId) ?? null;
}

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

export async function postDiscordEphemeral(
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

export function purchaseResultCard(result: PurchaseResult, checkoutUrl: string | null = null) {
  if (result.kind === "created" || result.kind === "duplicate") {
    return (
      <Card
        title={
          result.kind === "created"
            ? "✅🎉 PEDIDO CRIADO COM SUCESSO! 🎉✅"
            : "♻️✅ PEDIDO JÁ REGISTRADO ✅♻️"
        }
        subtitle="💜 GWStore • Pagamento seguro com LivePix"
      >
        <CardText>🛍️ **Produto escolhido:**</CardText>
        <CardText>
          {productEmoji(result.productName)} **{result.productName}** • 🔢 **{result.quantity} unidade{result.quantity === 1 ? "" : "s"}**
        </CardText>
        <CardText>🏷️ **Preço unitário:** {formatBrl(result.unitPriceCents)}</CardText>
        {result.discountReason === "server_booster" ? (
          <CardText>🧾 **Subtotal:** {formatBrl(result.subtotalPriceCents)}</CardText>
        ) : null}
        {result.discountReason === "server_booster" ? (
          <CardText>
            🚀💎 **Desconto Nitro Booster ({formatPercentage(result.discountBps)}):** -{formatBrl(result.discountAmountCents)}
          </CardText>
        ) : null}
        <CardText>💰💠 **Total no Pix:** **{formatBrl(result.totalPriceCents)}**</CardText>
        <CardText>🧾 **ID do pedido:** `{result.orderId}`</CardText>
        <Divider />
        <CardText>⏳💠 **Status:** aguardando pagamento via Pix.</CardText>
        <CardText>👇⚡ Clique no botão abaixo para abrir o checkout seguro:</CardText>
        {checkoutUrl ? (
          <Actions>
            <LinkButton url={checkoutUrl}>💠 PAGAR AGORA COM PIX ⚡</LinkButton>
          </Actions>
        ) : null}
        <Divider />
        <CardText>🎫🔔 Após a confirmação, criaremos automaticamente seu **ticket privado**.</CardText>
        <CardText>👤🤝 Somente você e os administradores terão acesso ao atendimento.</CardText>
        <CardText>🔒✨ Compra protegida do início ao fim pela **GWStore**.</CardText>
      </Card>
    );
  }

  const message = {
    invalid_request: "🧩 A solicitação de compra é inválida. Abra a loja novamente com **/loja**. 🛍️",
    invalid_quantity: `🔢 Informe uma quantidade inteira entre **1 e ${MAXIMUM_ORDER_QUANTITY}**.`,
    guild_not_authorized: "⛔🏰 Este servidor ainda não está autorizado a vender pela GWStore.",
    product_unavailable: "🔎🎁 Esse produto não está mais disponível no catálogo.",
    out_of_stock: "😔📦 Esse produto ficou sem estoque. Escolha outro item na **/loja**! ✨",
    insufficient_stock: `📦 A quantidade escolhida é maior que o estoque. Disponível agora: **${result.kind === "insufficient_stock" ? result.availableStock : 0} unidades**.`,
    quantity_below_minimum: `⚠️💠 A LivePix aceita Pix a partir de **${formatBrl(LIVEPIX_MINIMUM_BRL_CENTS)}**. Para este produto, escolha no mínimo **${result.kind === "quantity_below_minimum" ? result.minimumQuantity : 0} unidades** (total de **${result.kind === "quantity_below_minimum" ? formatBrl(result.minimumTotalCents) : formatBrl(0)}**).`,
    interaction_conflict: "♻️🧾 Essa interação já foi usada em outro pedido.",
  }[result.kind];
  return errorCard(message);
}

function errorCard(message: string) {
  return (
    <Card title="❌🚨 OPS! NÃO FOI POSSÍVEL CONTINUAR 🚨❌" subtitle="💜 A equipe GWStore está aqui para ajudar">
      <CardText>{message}</CardText>
      <CardText>🔄 Tente abrir a loja novamente com **/loja**. 🛍️✨</CardText>
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

function stockLabel(availableStock: number) {
  return availableStock === 1
    ? "1 unidade"
    : `${new Intl.NumberFormat("pt-BR").format(availableStock)} unidades`;
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

function logBotError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-bot:${operation}] ${message}`);
}
