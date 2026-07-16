/** @jsxImportSource chat */
import "server-only";

import {
  cardToDiscordPayload,
  createDiscordAdapter,
  DiscordContentFormat,
  DiscordInteractionResponseFlag,
} from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  Actions,
  Button,
  Card,
  CardLink,
  CardText,
  Chat,
  Divider,
  Select,
  SelectOption,
  toCardElement,
  type ChatElement,
} from "chat";

import { getSiteUrl } from "@/lib/env";
import { getLivePixClient } from "@/lib/livepix/client";
import { LivePixPaymentService } from "@/lib/livepix/payment-service";
import { SupabaseLivePixPaymentRepository } from "@/lib/livepix/supabase-repository";
import { BotCommerceService } from "./commerce-service";
import { fetchDiscordGuildIdentity, readDiscordInteraction } from "./discord-context";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import type { BotCatalogGame, BotCatalogProduct, BotCatalogSubstore, PurchaseResult } from "./types";

const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const DISCORD_SELECT_OPTION_LIMIT = 25;

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
      await event.channel.post(errorCard("Não foi possível carregar a loja agora. Tente novamente em instantes."));
    }
  });

  bot.onAction("select_product", async (event) => {
    try {
      const selected = findCatalogProduct(await service.listCatalog(), event.value);
      const card = selected
        ? selectedProductCard(selected)
        : errorCard("Esse produto não está mais disponível no catálogo.");
      await replyPrivately(event.raw, card, () =>
        event.thread
          ? event.thread.postEphemeral(event.user, card, { fallbackToDM: true })
          : Promise.resolve(null),
      );
    } catch (error) {
      logBotError("product_selection", error);
      const card = errorCard("Não foi possível carregar esse produto agora. Tente novamente em instantes.");
      await replyPrivately(event.raw, card, () =>
        event.thread
          ? event.thread.postEphemeral(event.user, card, { fallbackToDM: true })
          : Promise.resolve(null),
      );
    }
  });

  bot.onAction("buy", async (event) => {
    try {
      const context = readDiscordInteraction(event.raw, event.user.userId);
      if (!context.interactionId || !context.guildId || !context.userId || !event.value) {
        const card = errorCard(
          "A compra precisa ser iniciada dentro de um servidor Discord usando o botão da loja.",
        );
        await replyPrivately(event.raw, card, () =>
          event.thread
            ? event.thread.postEphemeral(event.user, card, { fallbackToDM: true })
            : Promise.resolve(null),
        );
        return;
      }

      const guild = await fetchDiscordGuildIdentity(context.guildId);
      const result = await service.purchase({
        interactionId: context.interactionId,
        buyerDiscordId: context.userId,
        productId: event.value,
        guild,
      });
      const checkoutUrl =
        result.kind === "created" || result.kind === "duplicate"
          ? (
              await new LivePixPaymentService(
                new SupabaseLivePixPaymentRepository(),
                getLivePixClient(),
              ).createCheckout(result.orderId, getSiteUrl())
            ).checkoutUrl
          : null;
      const card = purchaseResultCard(result, checkoutUrl);
      await replyPrivately(event.raw, card, () =>
        event.thread
          ? event.thread.postEphemeral(event.user, card, { fallbackToDM: true })
          : Promise.resolve(null),
      );
    } catch (error) {
      logBotError("purchase", error);
      const card = errorCard("Não foi possível criar o pedido. Nenhum item foi entregue ou revelado.");
      await replyPrivately(event.raw, card, () =>
        event.thread
          ? event.thread.postEphemeral(event.user, card, { fallbackToDM: true })
          : Promise.resolve(null),
      );
    }
  });

  return bot;
}

export function catalogCards(catalog: BotCatalogGame[]): ChatElement[] {
  const products = flattenCatalog(catalog);

  if (!products.length) {
    return [
      <Card key="empty-catalog" title="GWStore">
        <CardText>O catálogo ainda não tem produtos ativos.</CardText>
      </Card>,
    ];
  }

  const pages = chunk(products, DISCORD_SELECT_OPTION_LIMIT);
  return pages.map((page, index) => (
    <Card key={`catalog-${index}`} title={pages.length > 1 ? `GWStore · Produtos ${index + 1}/${pages.length}` : "GWStore · Produtos"}>
      <CardText>Selecione um produto na lista abaixo para ver os detalhes e continuar a compra.</CardText>
      <CardText>Somente você verá as próximas etapas e o link do pagamento.</CardText>
      <Divider />
      <Actions>
        <Select id="select_product" label="Produtos" placeholder="Escolha um produto">
          {page.map(({ game, substore, product }) => (
            <SelectOption
              key={product.id}
              label={truncateSelectText(`${product.name} — ${formatBrl(product.priceCents)}`)}
              value={product.id}
              description={truncateSelectText(
                `${game.name} · ${substore.title} · ${stockLabel(product.availableStock)}`,
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
    <Card title="Ajuda · GWStore">
      <CardText>Use **/loja** e selecione um produto na lista.</CardText>
      <CardText>Confira os detalhes privados e clique em **Comprar com Pix**.</CardText>
      <CardText>Após a confirmação, o bot cria um ticket privado para você e os administradores.</CardText>
      <CardText>Nenhum segredo de estoque é revelado antes da confirmação do pagamento.</CardText>
    </Card>
  );
}

type CatalogSelection = {
  game: BotCatalogGame;
  substore: BotCatalogSubstore;
  product: BotCatalogProduct;
};

function selectedProductCard({ game, substore, product }: CatalogSelection) {
  return (
    <Card title={product.name} subtitle={`${game.name} · ${substore.title}`} imageUrl={substore.imageUrl ?? undefined}>
      {product.description ? <CardText>{product.description}</CardText> : null}
      <CardText>Preço: **{formatBrl(product.priceCents)}**</CardText>
      <CardText>Estoque: **{stockLabel(product.availableStock)}**</CardText>
      <Divider />
      {product.availableStock > 0 ? (
        <Actions>
          <Button id="buy" value={product.id} style="primary">
            Comprar com Pix
          </Button>
        </Actions>
      ) : (
        <CardText>Esse produto está sem estoque no momento.</CardText>
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

function purchaseResultCard(result: PurchaseResult, checkoutUrl: string | null = null) {
  if (result.kind === "created" || result.kind === "duplicate") {
    return (
      <Card title={result.kind === "created" ? "Pedido criado" : "Pedido já registrado"}>
        <CardText>
          **{result.productName}** · {formatBrl(result.priceCents)}
        </CardText>
        <CardText>ID do pedido: `{result.orderId}`</CardText>
        <Divider />
        <CardText>Status: **aguardando pagamento**. Pague pelo checkout da LivePix abaixo.</CardText>
        {checkoutUrl ? (
          <Actions>
            <CardLink url={checkoutUrl}>Pagar com Pix</CardLink>
          </Actions>
        ) : null}
        <CardText>O ticket privado será criado automaticamente após a confirmação do pagamento.</CardText>
      </Card>
    );
  }

  const message = {
    invalid_request: "A solicitação de compra é inválida.",
    guild_not_authorized: "Este servidor ainda não está autorizado a vender pela GWStore.",
    product_unavailable: "Esse produto não está mais disponível no catálogo.",
    out_of_stock: "Esse produto está sem estoque no momento.",
    interaction_conflict: "Essa interação já foi usada em outro pedido.",
  }[result.kind];
  return errorCard(message);
}

function errorCard(message: string) {
  return (
    <Card title="Não foi possível continuar">
      <CardText>{message}</CardText>
    </Card>
  );
}

function formatBrl(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function stockLabel(availableStock: number) {
  return availableStock === 1 ? "1 unidade" : `${availableStock} unidades`;
}

function truncateSelectText(text: string) {
  return text.length <= 100 ? text : `${text.slice(0, 97)}...`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function logBotError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-bot:${operation}] ${message}`);
}
