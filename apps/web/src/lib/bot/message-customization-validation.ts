import { z } from "zod";

import {
  BOT_MESSAGE_FIELD_LIMITS,
  BOT_MESSAGE_TOKEN_ALLOWLIST,
  botMessageLines,
  type BotMessageCustomization,
} from "./message-customization";

const TOKEN_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const MAX_CONFIG_BYTES = 64 * 1024;
// The Discord adapter prefixes card titles with "# " before enforcing 4,000.
const COMPONENTS_V2_TEXT_LIMIT = 3_998;

const TOKEN_LENGTH_BUDGETS: Record<string, number> = {
  page: 3,
  pages: 3,
  product_emoji: 12,
  product_name: 160,
  game_name: 120,
  substore_title: 100,
  price: 40,
  stock: 40,
  minimum_quantity: 5,
  minimum_total: 40,
  maximum_quantity: 5,
  discount_percent: 20,
  available_stock: 20,
  minimum_pix: 40,
  game_nickname: 64,
};

const optionalFields = new Set([
  "storefront.welcome",
  "storefront.catalogText",
  "storefront.privacyText",
  "storefront.paymentText",
  "storefront.prompt",
  "storefront.emptyText",
  "storefront.emptyHint",
  "product.selectedText",
  "product.priceText",
  "product.stockText",
  "product.minimumText",
  "product.invalidPriceText",
  "product.deliveryText",
  "product.privacyText",
  "product.insufficientStockText",
  "product.outOfStockText",
  "order.productLabel",
  "order.unitPriceLabel",
  "order.subtotalLabel",
  "order.discountLabel",
  "order.totalLabel",
  "order.orderIdLabel",
  "order.statusText",
  "order.paymentPrompt",
  "order.ticketText",
  "order.privacyText",
  "order.protectedText",
  "help.subtitle",
  "help.body",
  "error.subtitle",
  "error.retryText",
  "ticket.description",
]);

function textField(path: keyof typeof BOT_MESSAGE_FIELD_LIMITS) {
  const maximum = BOT_MESSAGE_FIELD_LIMITS[path];
  const cleaned = z.string().transform(cleanDiscordText);
  const constrained = z.string().max(maximum, `Use no máximo ${maximum} caracteres.`);
  return cleaned.pipe(
    optionalFields.has(path)
      ? constrained
      : constrained.min(1, "Este texto é obrigatório."),
  );
}

const storefrontSchema = z.object({
  title: textField("storefront.title"),
  paginatedTitle: textField("storefront.paginatedTitle"),
  subtitle: textField("storefront.subtitle"),
  welcome: textField("storefront.welcome"),
  catalogText: textField("storefront.catalogText"),
  privacyText: textField("storefront.privacyText"),
  paymentText: textField("storefront.paymentText"),
  prompt: textField("storefront.prompt"),
  selectLabel: textField("storefront.selectLabel"),
  selectPlaceholder: textField("storefront.selectPlaceholder"),
  emptyTitle: textField("storefront.emptyTitle"),
  emptyText: textField("storefront.emptyText"),
  emptyHint: textField("storefront.emptyHint"),
}).strict();

const productSchema = z.object({
  title: textField("product.title"),
  subtitle: textField("product.subtitle"),
  selectedText: textField("product.selectedText"),
  priceText: textField("product.priceText"),
  stockText: textField("product.stockText"),
  minimumText: textField("product.minimumText"),
  invalidPriceText: textField("product.invalidPriceText"),
  deliveryText: textField("product.deliveryText"),
  privacyText: textField("product.privacyText"),
  buttonLabel: textField("product.buttonLabel"),
  insufficientStockText: textField("product.insufficientStockText"),
  outOfStockText: textField("product.outOfStockText"),
}).strict();

const quantitySchema = z.object({
  modalTitle: textField("quantity.modalTitle"),
  inputLabel: textField("quantity.inputLabel"),
  inputPlaceholder: textField("quantity.inputPlaceholder"),
  unavailableText: textField("quantity.unavailableText"),
  invalidPriceText: textField("quantity.invalidPriceText"),
  insufficientStockText: textField("quantity.insufficientStockText"),
}).strict();

const orderSchema = z.object({
  createdTitle: textField("order.createdTitle"),
  duplicateTitle: textField("order.duplicateTitle"),
  subtitle: textField("order.subtitle"),
  productLabel: textField("order.productLabel"),
  unitPriceLabel: textField("order.unitPriceLabel"),
  subtotalLabel: textField("order.subtotalLabel"),
  discountLabel: textField("order.discountLabel"),
  totalLabel: textField("order.totalLabel"),
  orderIdLabel: textField("order.orderIdLabel"),
  statusText: textField("order.statusText"),
  paymentPrompt: textField("order.paymentPrompt"),
  paymentButtonLabel: textField("order.paymentButtonLabel"),
  ticketText: textField("order.ticketText"),
  privacyText: textField("order.privacyText"),
  protectedText: textField("order.protectedText"),
}).strict();

const helpSchema = z.object({
  title: textField("help.title"),
  subtitle: textField("help.subtitle"),
  body: textField("help.body"),
}).strict();

const errorSchema = z.object({
  title: textField("error.title"),
  subtitle: textField("error.subtitle"),
  retryText: textField("error.retryText"),
  invalidRequest: textField("error.invalidRequest"),
  invalidQuantity: textField("error.invalidQuantity"),
  guildNotAuthorized: textField("error.guildNotAuthorized"),
  productUnavailable: textField("error.productUnavailable"),
  outOfStock: textField("error.outOfStock"),
  insufficientStock: textField("error.insufficientStock"),
  quantityBelowMinimum: textField("error.quantityBelowMinimum"),
  interactionConflict: textField("error.interactionConflict"),
  storeUnavailable: textField("error.storeUnavailable"),
  productLoadFailure: textField("error.productLoadFailure"),
  purchaseFailure: textField("error.purchaseFailure"),
  outsideServer: textField("error.outsideServer"),
}).strict();

const ticketSchema = z.object({
  title: textField("ticket.title"),
  description: textField("ticket.description"),
  productLabel: textField("ticket.productLabel"),
  quantityLabel: textField("ticket.quantityLabel"),
  amountLabel: textField("ticket.amountLabel"),
  orderLabel: textField("ticket.orderLabel"),
  nicknamePromptText: textField("ticket.nicknamePromptText"),
  nicknameButtonLabel: textField("ticket.nicknameButtonLabel"),
  nicknameModalTitle: textField("ticket.nicknameModalTitle"),
  nicknameInputLabel: textField("ticket.nicknameInputLabel"),
  nicknameInputPlaceholder: textField("ticket.nicknameInputPlaceholder"),
  nicknameSavedText: textField("ticket.nicknameSavedText"),
  nicknameUpdatedText: textField("ticket.nicknameUpdatedText"),
  nicknameInvalidText: textField("ticket.nicknameInvalidText"),
  nicknameUnauthorizedText: textField("ticket.nicknameUnauthorizedText"),
  nicknameUnavailableText: textField("ticket.nicknameUnavailableText"),
  closeButtonLabel: textField("ticket.closeButtonLabel"),
  closeConfirmationText: textField("ticket.closeConfirmationText"),
  closeConfirmButtonLabel: textField("ticket.closeConfirmButtonLabel"),
  closeCancelButtonLabel: textField("ticket.closeCancelButtonLabel"),
  closeUnauthorizedText: textField("ticket.closeUnauthorizedText"),
  closeInProgressText: textField("ticket.closeInProgressText"),
  closeSuccessText: textField("ticket.closeSuccessText"),
  closeUnavailableText: textField("ticket.closeUnavailableText"),
}).strict();

export const botMessageCustomizationSchema = z.object({
  version: z.literal(1),
  storefront: storefrontSchema,
  product: productSchema,
  quantity: quantitySchema,
  order: orderSchema,
  help: helpSchema,
  error: errorSchema,
  ticket: ticketSchema,
}).strict().superRefine((value, context) => {
  validatePlaceholders(value, context);
  validateRenderedLimits(value, context);

  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_CONFIG_BYTES) {
    context.addIssue({
      code: "custom",
      path: [],
      message: "A personalização completa ultrapassa o limite de 64 KiB.",
    });
  }
});

function validatePlaceholders(
  value: BotMessageCustomization,
  context: z.RefinementCtx,
) {
  for (const [path, maximum] of Object.entries(BOT_MESSAGE_FIELD_LIMITS)) {
    const fieldValue = readPath(value, path);
    const allowed = new Set(BOT_MESSAGE_TOKEN_ALLOWLIST[path] ?? []);
    for (const match of fieldValue.matchAll(TOKEN_PATTERN)) {
      const token = match[1];
      if (!allowed.has(token)) {
        context.addIssue({
          code: "custom",
          path: path.split("."),
          message: `A variável {${match[1]}} não está disponível neste campo.`,
        });
      }
    }
    if (estimateExpandedLength(fieldValue) > maximum) {
      context.addIssue({
        code: "custom",
        path: path.split("."),
        message: `O texto pode ultrapassar ${maximum} caracteres após preencher as variáveis.`,
      });
    }
  }

  for (const path of ["ticket.nicknameSavedText", "ticket.nicknameUpdatedText"] as const) {
    if (!readPath(value, path).includes("{game_nickname}")) {
      context.addIssue({
        code: "custom",
        path: path.split("."),
        message: "Inclua {game_nickname} para a equipe visualizar o nick informado.",
      });
    }
  }
}

function validateRenderedLimits(
  value: BotMessageCustomization,
  context: z.RefinementCtx,
) {
  const storefrontBase = [
    value.storefront.subtitle,
    value.storefront.welcome,
    value.storefront.catalogText,
    value.storefront.privacyText,
    value.storefront.paymentText,
    value.storefront.prompt,
  ];
  validateCardTotal(
    [value.storefront.title, ...storefrontBase],
    ["storefront"],
    context,
  );
  validateCardTotal(
    [value.storefront.paginatedTitle, ...storefrontBase],
    ["storefront"],
    context,
  );
  validateCardTotal(
    [value.storefront.emptyTitle, value.storefront.emptyText, value.storefront.emptyHint],
    ["storefront"],
    context,
  );
  validateCardTotal(Object.values(value.product), ["product"], context, 2_600);
  validateCardTotal(Object.values(value.order), ["order"], context, 3_200);
  validateCardTotal(Object.values(value.help), ["help"], context);

  if (botMessageLines(value.help.body).length > 32) {
    context.addIssue({
      code: "custom",
      path: ["help", "body"],
      message: "A ajuda pode ter no máximo 32 linhas para respeitar o limite de componentes do Discord.",
    });
  }

  const errorBase = [value.error.title, value.error.subtitle, value.error.retryText];
  for (const [key, message] of Object.entries(value.error)) {
    if (key === "title" || key === "subtitle" || key === "retryText") continue;
    validateCardTotal([...errorBase, message], ["error", key], context);
  }

  const ticketTotal = [
    value.ticket.title,
    value.ticket.description,
    value.ticket.productLabel,
    value.ticket.quantityLabel,
    value.ticket.amountLabel,
    value.ticket.orderLabel,
  ]
    .reduce((sum, field) => sum + estimateExpandedLength(field), 0);
  if (ticketTotal > 5_400) {
    context.addIssue({
      code: "custom",
      path: ["ticket"],
      message: "Os textos do ticket deixam pouco espaço para os dados do pedido (máximo seguro: 5.400).",
    });
  }
}

function validateCardTotal(
  fields: string[],
  path: PropertyKey[],
  context: z.RefinementCtx,
  maximum = COMPONENTS_V2_TEXT_LIMIT,
) {
  const total = fields.reduce((sum, field) => sum + estimateExpandedLength(field), 0);
  if (total > maximum) {
    context.addIssue({
      code: "custom",
      path,
      message: `Os textos combinados ultrapassam o limite seguro de ${maximum.toLocaleString("pt-BR")} caracteres.`,
    });
  }
}

function estimateExpandedLength(value: string) {
  return value.replace(TOKEN_PATTERN, (_match, name: string) =>
    "x".repeat(TOKEN_LENGTH_BUDGETS[name] ?? 0),
  ).length;
}

function readPath(value: BotMessageCustomization, path: string): string {
  const [section, field] = path.split(".") as [keyof BotMessageCustomization, string];
  const sectionValue = value[section];
  if (typeof sectionValue !== "object" || sectionValue === null) return "";
  const fieldValue = (sectionValue as unknown as Record<string, unknown>)[field];
  return typeof fieldValue === "string" ? fieldValue : "";
}

function cleanDiscordText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}
