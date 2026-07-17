"use client";

import Image from "next/image";
import { ChevronDown, MessageSquareText, Send } from "lucide-react";

import gwStoreLogo from "@/app/icon.png";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form-field";
import {
  BOT_MESSAGE_TOKEN_ALLOWLIST,
  interpolateBotMessage,
  type BotMessageCustomization,
} from "@/lib/bot/message-customization";

export type DiscordPreviewScenario =
  | "storefront"
  | "product"
  | "quantity"
  | "order"
  | "help"
  | "error"
  | "ticket";

const PREVIEW_SCENARIOS: Array<{ value: DiscordPreviewScenario; label: string }> = [
  { value: "storefront", label: "Vitrine pública" },
  { value: "product", label: "Produto selecionado" },
  { value: "quantity", label: "Modal de quantidade" },
  { value: "order", label: "Pedido e pagamento" },
  { value: "help", label: "Ajuda" },
  { value: "error", label: "Erro" },
  { value: "ticket", label: "Ticket pós-pagamento" },
];

const PREVIEW_TOKENS: Record<string, string | number> = {
  store_name: "GWStore",
  page: 1,
  pages: 2,
  total_pages: 2,
  game_name: "Grow a Garden 2",
  substore_name: "Itens especiais",
  substore_title: "Itens especiais",
  product_name: "Dragon's Breath",
  product_emoji: "🐉🔥",
  price: "R$ 12,50",
  stock: "24 unidades",
  available_stock: 24,
  minimum_quantity: 1,
  minimum_total: "R$ 12,50",
  minimum_pix: "R$ 1,00",
  maximum_quantity: 100,
  quantity: 2,
  subtotal: "R$ 25,00",
  discount_percent: "5%",
  discount_amount: "R$ 1,25",
  total: "R$ 23,75",
  order_id: "8d31a2c9-42ee-4c75-a218-63e92f89ca12",
};

interface DiscordMessagePreviewProps {
  config: BotMessageCustomization;
  scenario: DiscordPreviewScenario;
  onScenarioChange: (scenario: DiscordPreviewScenario) => void;
}

export function DiscordMessagePreview({
  config,
  scenario,
  onScenarioChange,
}: DiscordMessagePreviewProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[#5865f2]/30 bg-[#5865f2]/10 text-[#aab1ff]">
              <MessageSquareText aria-hidden="true" className="size-[18px]" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Prévia no Discord</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                Exemplo visual com dados fictícios.
              </p>
            </div>
          </div>
          <Badge tone="neutral">Ao vivo</Badge>
        </div>

        <Select
          aria-label="Mensagem exibida na prévia"
          className="mt-4"
          value={scenario}
          onChange={(event) => onScenarioChange(event.target.value as DiscordPreviewScenario)}
        >
          {PREVIEW_SCENARIOS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </CardHeader>

      <CardContent className="bg-[#1e1f22] p-4 sm:p-5">
        <div className="min-h-[31rem] rounded-xl border border-white/[0.06] bg-[#313338] p-4 shadow-[0_18px_40px_rgba(0,0,0,.28)] sm:p-5">
          <div className="flex items-start gap-3">
            <span className="relative mt-0.5 size-10 shrink-0 overflow-hidden rounded-full bg-black">
              <Image
                src={gwStoreLogo}
                alt=""
                fill
                sizes="40px"
                className="object-cover"
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-sm leading-none">
                <span className="font-semibold text-[#f0b232]">GWStore</span>
                <span className="rounded-[3px] bg-[#5865f2] px-1 py-0.5 text-[9px] font-bold uppercase text-white">
                  App
                </span>
                <span className="text-[11px] text-[#949ba4]">agora</span>
              </div>

              {scenario === "quantity" ? (
                <QuantityPreview config={config} />
              ) : scenario === "ticket" ? (
                <TicketPreview config={config} />
              ) : (
                <CardMessagePreview config={config} scenario={scenario} />
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] leading-5 text-muted">
          A quebra de linhas pode variar um pouco conforme o dispositivo e a versão do Discord.
        </p>
      </CardContent>
    </Card>
  );
}

function CardMessagePreview({
  config,
  scenario,
}: {
  config: BotMessageCustomization;
  scenario: Exclude<DiscordPreviewScenario, "quantity" | "ticket">;
}) {
  const message = previewCard(config, scenario);

  return (
    <div className="overflow-hidden rounded-lg border border-[#3f4147] bg-[#2b2d31] shadow-sm">
      <div className="border-l-4 border-[#5865f2] px-4 py-3.5">
        <DiscordText className="text-base font-semibold leading-6 text-[#f2f3f5]">
          {message.title}
        </DiscordText>
        {message.subtitle ? (
          <DiscordText className="mt-0.5 text-sm leading-5 text-[#dbdee1]">
            {message.subtitle}
          </DiscordText>
        ) : null}

        <div className="mt-3 space-y-1.5 text-sm leading-[1.45] text-[#dbdee1]">
          {message.paragraphs.filter(Boolean).map((paragraph, index) => (
            <DiscordText key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</DiscordText>
          ))}
        </div>

        {message.action ? (
          <div className="mt-3 border-t border-[#3f4147] pt-3">
            {message.action.kind === "select" ? (
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-[#1e1f22] bg-[#1e1f22] px-3 text-sm text-[#b5bac1]">
                <DiscordText className="truncate">{message.action.label}</DiscordText>
                <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
              </div>
            ) : (
              <span className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#5865f2] px-3 text-sm font-medium text-white">
                <Send aria-hidden="true" className="size-3.5" />
                <DiscordText>{message.action.label}</DiscordText>
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QuantityPreview({ config }: { config: BotMessageCustomization }) {
  const quantity = config.quantity;

  return (
    <div className="rounded-lg border border-[#1e1f22] bg-[#2b2d31] p-4 shadow-[0_14px_36px_rgba(0,0,0,.35)]">
      <DiscordText className="text-lg font-semibold text-[#f2f3f5]">
        {renderText(quantity.modalTitle)}
      </DiscordText>
      <div className="mt-4">
        <DiscordText className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#b5bac1]">
        {renderField("quantity.inputLabel", quantity.inputLabel)}
        </DiscordText>
        <div className="h-10 rounded-md border border-[#1e1f22] bg-[#1e1f22] px-3 py-2 text-sm text-[#87898c]">
          {renderField("quantity.inputPlaceholder", quantity.inputPlaceholder)}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <span className="rounded-md bg-[#5865f2] px-4 py-2 text-sm font-medium text-white">Enviar</span>
      </div>
    </div>
  );
}

function TicketPreview({ config }: { config: BotMessageCustomization }) {
  const ticket = config.ticket;
  const fields = [
    [ticket.productLabel, PREVIEW_TOKENS.product_name],
    [ticket.quantityLabel, PREVIEW_TOKENS.quantity],
    [ticket.amountLabel, PREVIEW_TOKENS.total],
    [ticket.orderLabel, PREVIEW_TOKENS.order_id],
  ];

  return (
    <div className="rounded border-l-4 border-[#a855f7] bg-[#2b2d31] px-4 py-3.5">
      <DiscordText className="font-semibold text-[#f2f3f5]">
        {renderText(ticket.title)}
      </DiscordText>
      <DiscordText className="mt-2 text-sm leading-5 text-[#dbdee1]">
        {renderText(ticket.description)}
      </DiscordText>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {fields.map(([label, value], index) => (
          <div key={`${label}-${index}`} className={index === 3 ? "sm:col-span-2" : undefined}>
            <DiscordText className="text-xs font-semibold text-[#f2f3f5]">
              {renderText(String(label))}
            </DiscordText>
            <p className="mt-0.5 break-words text-sm text-[#dbdee1]">{String(value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function previewCard(
  config: BotMessageCustomization,
  scenario: Exclude<DiscordPreviewScenario, "quantity" | "ticket">,
) {
  if (scenario === "product") {
    return {
      title: renderField("product.title", config.product.title),
      subtitle: renderField("product.subtitle", config.product.subtitle),
      paragraphs: [
        config.product.selectedText,
        renderField("product.priceText", config.product.priceText),
        renderField("product.stockText", config.product.stockText),
        renderField("product.minimumText", config.product.minimumText),
        config.product.deliveryText,
        config.product.privacyText,
      ].map(renderText),
      action: { kind: "button" as const, label: renderText(config.product.buttonLabel) },
    };
  }

  if (scenario === "order") {
    return {
      title: renderText(config.order.createdTitle),
      subtitle: renderText(config.order.subtitle),
      paragraphs: [
        `${renderText(config.order.productLabel)} ${PREVIEW_TOKENS.product_name}`,
        `${renderText(config.order.unitPriceLabel)} ${PREVIEW_TOKENS.price}`,
        `${renderText(config.order.subtotalLabel)} ${PREVIEW_TOKENS.subtotal}`,
        `${renderField("order.discountLabel", config.order.discountLabel)} -${PREVIEW_TOKENS.discount_amount}`,
        `${renderText(config.order.totalLabel)} ${PREVIEW_TOKENS.total}`,
        `${renderText(config.order.orderIdLabel)} ${PREVIEW_TOKENS.order_id}`,
        config.order.statusText,
        config.order.paymentPrompt,
        config.order.ticketText,
        config.order.privacyText,
        config.order.protectedText,
      ].map(renderText),
      action: { kind: "button" as const, label: renderText(config.order.paymentButtonLabel) },
    };
  }

  if (scenario === "help") {
    return {
      title: renderText(config.help.title),
      subtitle: renderText(config.help.subtitle),
      paragraphs: [renderText(config.help.body)],
      action: null,
    };
  }

  if (scenario === "error") {
    return {
      title: renderText(config.error.title),
      subtitle: renderText(config.error.subtitle),
      paragraphs: [config.error.invalidRequest, config.error.retryText].map(renderText),
      action: null,
    };
  }

  return {
    title: renderText(config.storefront.title),
    subtitle: renderText(config.storefront.subtitle),
    paragraphs: [
      config.storefront.welcome,
      config.storefront.catalogText,
      config.storefront.privacyText,
      config.storefront.paymentText,
      config.storefront.prompt,
    ].map(renderText),
    action: { kind: "select" as const, label: renderText(config.storefront.selectPlaceholder) },
  };
}

function renderText(template: string) {
  return interpolateBotMessage(template, {});
}

function renderField(path: string, template: string) {
  const tokens = Object.fromEntries(
    (BOT_MESSAGE_TOKEN_ALLOWLIST[path] ?? []).map((token) => [token, PREVIEW_TOKENS[token]]),
  ) as Record<string, string | number>;
  return interpolateBotMessage(template, tokens);
}

function DiscordText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const chunks = children.split(/(\*\*[^*]+\*\*|`[^`\n]+`)/g);

  return (
    <p className={className ? `${className} whitespace-pre-wrap break-words` : "whitespace-pre-wrap break-words"}>
      {chunks.map((chunk, index) => {
        if (chunk.startsWith("**") && chunk.endsWith("**")) {
          return <strong key={index}>{chunk.slice(2, -2)}</strong>;
        }
        if (chunk.startsWith("`") && chunk.endsWith("`")) {
          return (
            <code key={index} className="rounded bg-[#1e1f22] px-1 py-0.5 font-mono text-[.92em]">
              {chunk.slice(1, -1)}
            </code>
          );
        }
        return chunk;
      })}
    </p>
  );
}
