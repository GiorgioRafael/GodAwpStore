/** @jsxImportSource chat */
import "server-only";

import {
  createDiscordAdapter,
  DiscordInteractionResponseFlag,
} from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Actions, Button, Card, CardLink, CardText, Chat, Divider, type ChatElement } from "chat";

import { getSiteUrl } from "@/lib/env";
import { getLivePixClient } from "@/lib/livepix/client";
import { LivePixPaymentService } from "@/lib/livepix/payment-service";
import { SupabaseLivePixPaymentRepository } from "@/lib/livepix/supabase-repository";
import { BotCommerceService } from "./commerce-service";
import { fetchDiscordGuildIdentity, readDiscordInteraction } from "./discord-context";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import type { BotCatalogGame, PurchaseResult } from "./types";

let botSingleton: ReturnType<typeof createBot> | undefined;

export function getDiscordBot() {
  botSingleton ??= createBot();
  return botSingleton;
}

function createBot() {
  const service = new BotCommerceService(new SupabaseBotCommerceRepository());
  const discord = createDiscordAdapter({
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

  bot.onAction("buy", async (event) => {
    if (!event.thread) return;

    try {
      const context = readDiscordInteraction(event.raw, event.user.userId);
      if (!context.interactionId || !context.guildId || !context.userId || !event.value) {
        await event.thread.post(
          errorCard("A compra precisa ser iniciada dentro de um servidor Discord usando o botão da loja."),
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
      await event.thread.post(purchaseResultCard(result, checkoutUrl));
    } catch (error) {
      logBotError("purchase", error);
      await event.thread.post(errorCard("Não foi possível criar o pedido. Nenhum item foi entregue ou revelado."));
    }
  });

  return bot;
}

export function catalogCards(catalog: BotCatalogGame[]): ChatElement[] {
  const cards: ChatElement[] = [];
  for (const game of catalog) {
    for (const substore of game.substores) {
      const productLines = substore.products.map(
        (product) =>
          `**${product.name}** — ${formatBrl(product.priceCents)} · ${product.availableStock} em estoque`,
      );
      const actionRows: ChatElement[] = [];

      for (let index = 0; index < substore.products.length; index += 3) {
        const products = substore.products.slice(index, index + 3);
        actionRows.push(
          <Actions key={`${substore.id}-actions-${index / 3}`}>
            {products.map((product) => (
              <Button
                key={product.id}
                id="buy"
                value={product.id}
                style="primary"
                disabled={product.availableStock < 1}
              >
                {truncateButtonLabel(`Comprar ${product.name}`)}
              </Button>
            ))}
          </Actions>,
        );
      }

      cards.push(
        <Card
          key={substore.id}
          title={`${game.name} · ${substore.title}`}
          imageUrl={substore.imageUrl ?? undefined}
        >
          {substore.description ? <CardText>{substore.description}</CardText> : null}
          <CardText>{productLines.join("\n")}</CardText>
          <Divider />
          {...actionRows}
        </Card>,
      );
    }
  }

  return cards.length
    ? cards
    : [
        <Card key="empty-catalog" title="GWStore">
          <CardText>O catálogo ainda não tem produtos ativos.</CardText>
        </Card>,
      ];
}

function helpCard() {
  return (
    <Card title="Ajuda · GWStore">
      <CardText>Use **/loja** para ver produtos, preços e estoque em tempo real.</CardText>
      <CardText>Clique em **Comprar** para abrir o checkout Pix seguro da LivePix.</CardText>
      <CardText>Após a confirmação, o bot cria um ticket privado para você e os administradores.</CardText>
      <CardText>Nenhum segredo de estoque é revelado antes da confirmação do pagamento.</CardText>
    </Card>
  );
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

function truncateButtonLabel(label: string) {
  return label.length <= 80 ? label : `${label.slice(0, 77)}...`;
}

function logBotError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-bot:${operation}] ${message}`);
}
