import type { Json, JsonObject } from "@/lib/supabase/database.types";

export const BOT_MESSAGE_CONFIG_VERSION = 1 as const;

export type BotMessageCustomization = {
  version: typeof BOT_MESSAGE_CONFIG_VERSION;
  storefront: {
    title: string;
    paginatedTitle: string;
    subtitle: string;
    welcome: string;
    catalogText: string;
    privacyText: string;
    paymentText: string;
    prompt: string;
    selectLabel: string;
    selectPlaceholder: string;
    emptyTitle: string;
    emptyText: string;
    emptyHint: string;
  };
  product: {
    title: string;
    subtitle: string;
    selectedText: string;
    priceText: string;
    stockText: string;
    minimumText: string;
    invalidPriceText: string;
    deliveryText: string;
    privacyText: string;
    buttonLabel: string;
    insufficientStockText: string;
    outOfStockText: string;
  };
  quantity: {
    modalTitle: string;
    inputLabel: string;
    inputPlaceholder: string;
    unavailableText: string;
    invalidPriceText: string;
    insufficientStockText: string;
  };
  order: {
    createdTitle: string;
    duplicateTitle: string;
    subtitle: string;
    productLabel: string;
    unitPriceLabel: string;
    subtotalLabel: string;
    discountLabel: string;
    totalLabel: string;
    orderIdLabel: string;
    statusText: string;
    paymentPrompt: string;
    paymentButtonLabel: string;
    ticketText: string;
    privacyText: string;
    protectedText: string;
  };
  help: {
    title: string;
    subtitle: string;
    body: string;
  };
  error: {
    title: string;
    subtitle: string;
    retryText: string;
    invalidRequest: string;
    invalidQuantity: string;
    guildNotAuthorized: string;
    productUnavailable: string;
    outOfStock: string;
    insufficientStock: string;
    quantityBelowMinimum: string;
    interactionConflict: string;
    storeUnavailable: string;
    productLoadFailure: string;
    purchaseFailure: string;
    outsideServer: string;
  };
  ticket: {
    title: string;
    description: string;
    productLabel: string;
    quantityLabel: string;
    amountLabel: string;
    orderLabel: string;
  };
};

export const DEFAULT_BOT_MESSAGE_CUSTOMIZATION: BotMessageCustomization = {
  version: BOT_MESSAGE_CONFIG_VERSION,
  storefront: {
    title: "🛍️✨ GWSTORE • LOJA OFICIAL ✨🛍️",
    paginatedTitle: "🛍️✨ GWSTORE • PRODUTOS {page}/{pages} ✨🛍️",
    subtitle: "🌱 Grow a Garden 2 • ⚡ Compra rápida, privada e segura",
    welcome: "👋💜 **Bem-vindo(a) à GWStore!** 💜👋",
    catalogText: "🎮 Escolha seu produto favorito e prepare-se para turbinar sua conta! 🚀✨",
    privacyText: "🔒 Somente **você** verá os detalhes, o pedido e o link de pagamento. 🛡️",
    paymentText: "💠 Pagamento rápido e seguro via **Pix com LivePix**. ⚡✅",
    prompt: "👇🛒 **Abra a lista abaixo e selecione seu produto:**",
    selectLabel: "🛒 Catálogo de produtos",
    selectPlaceholder: "✨ Clique aqui e escolha seu produto ✨",
    emptyTitle: "🛍️✨ GWSTORE • LOJA OFICIAL ✨🛍️",
    emptyText: "😴 Nosso catálogo está descansando e ainda não tem produtos ativos.",
    emptyHint: "🔔 Volte em breve para conferir as novidades! 💜",
  },
  product: {
    title: "{product_emoji}✨ {product_name} ✨{product_emoji}",
    subtitle: "🎮 {game_name} • 🏪 {substore_title}",
    selectedText: "🎉 **Você escolheu um produto incrível!** 🎉",
    priceText: "💰💠 **Preço por unidade:** {price}",
    stockText: "📦✅ **Estoque disponível:** {stock}",
    minimumText:
      "⚠️💠 **Mínimo da LivePix:** {minimum_quantity} unidade(s) • **{minimum_total}**",
    invalidPriceText: "🚫💸 Este produto está sem um preço válido para pagamento.",
    deliveryText: "🚀🎫 **Entrega:** atendimento manual em ticket privado após a confirmação.",
    privacyText: "🔐🛡️ Seu pedido e seu pagamento ficam visíveis somente para você.",
    buttonLabel: "🔢 Escolher quantidade 🛒",
    insufficientStockText:
      "⚠️📦 O estoque atual não alcança as **{minimum_quantity} unidades mínimas** exigidas para gerar um Pix.",
    outOfStockText: "😔💨 **Produto esgotado no momento.** Volte em breve! 🔔✨",
  },
  quantity: {
    modalTitle: "Escolha a quantidade",
    inputLabel: "Quantidade (mínimo {minimum_quantity})",
    inputPlaceholder: "De {minimum_quantity} até {maximum_quantity}",
    unavailableText: "🔎🎁 Esse produto não está mais disponível. Abra a loja novamente com /loja.",
    invalidPriceText: "🚫💸 Este produto está sem um preço válido para pagamento.",
    insufficientStockText:
      "⚠️📦 O estoque atual não alcança as {minimum_quantity} unidades mínimas para gerar o Pix.",
  },
  order: {
    createdTitle: "✅🎉 PEDIDO CRIADO COM SUCESSO! 🎉✅",
    duplicateTitle: "♻️✅ PEDIDO JÁ REGISTRADO ✅♻️",
    subtitle: "💜 GWStore • Pagamento seguro com LivePix",
    productLabel: "🛍️ **Produto escolhido:**",
    unitPriceLabel: "🏷️ **Preço unitário:**",
    subtotalLabel: "🧾 **Subtotal:**",
    discountLabel: "🚀💎 **Desconto Nitro Booster ({discount_percent}):**",
    totalLabel: "💰💠 **Total no Pix:**",
    orderIdLabel: "🧾 **ID do pedido:**",
    statusText: "⏳💠 **Status:** aguardando pagamento via Pix.",
    paymentPrompt: "👇⚡ Clique no botão abaixo para abrir o checkout seguro:",
    paymentButtonLabel: "💠 PAGAR AGORA COM PIX ⚡",
    ticketText: "🎫🔔 Após a confirmação, criaremos automaticamente seu **ticket privado**.",
    privacyText: "👤🤝 Somente você e os administradores terão acesso ao atendimento.",
    protectedText: "🔒✨ Compra protegida do início ao fim pela **GWStore**.",
  },
  help: {
    title: "🆘✨ AJUDA • GWSTORE ✨🆘",
    subtitle: "💜 Comprar é rápido, privado e seguro!",
    body: [
      "1️⃣ Vá até o canal da loja e abra a **lista de produtos**. 🛍️✨",
      "2️⃣ Escolha um produto no menu suspenso. 👇🎁",
      "3️⃣ Confira preço e estoque e clique em **🔢 Escolher quantidade**.",
      "4️⃣ Informe a quantidade; o total precisa atingir o mínimo de **R$ 1,00** da LivePix. 💠",
      "5️⃣ Pague com segurança pelo checkout da **LivePix**. 🔒✅",
      "6️⃣ Após a confirmação, abrimos um ticket privado com você e os administradores. 🎫👑",
      "---",
      "🔄 Não encontrou a vitrine? Digite **/loja** para abrir o catálogo alternativo.",
      "🛡️ Nenhum dado protegido do estoque é revelado antes da confirmação do pagamento.",
      "💬 Precisou de ajuda? Fale com a equipe no seu ticket! 🤝💜",
    ].join("\n"),
  },
  error: {
    title: "❌🚨 OPS! NÃO FOI POSSÍVEL CONTINUAR 🚨❌",
    subtitle: "💜 A equipe GWStore está aqui para ajudar",
    retryText: "🔄 Tente abrir a loja novamente com **/loja**. 🛍️✨",
    invalidRequest: "🧩 A solicitação de compra é inválida. Abra a loja novamente com **/loja**. 🛍️",
    invalidQuantity: "🔢 Informe uma quantidade inteira entre **1 e {maximum_quantity}**.",
    guildNotAuthorized: "⛔🏰 Este servidor ainda não está autorizado a vender pela GWStore.",
    productUnavailable: "🔎🎁 Esse produto não está mais disponível no catálogo.",
    outOfStock: "😔📦 Esse produto ficou sem estoque. Escolha outro item na **/loja**! ✨",
    insufficientStock:
      "📦 A quantidade escolhida é maior que o estoque. Disponível agora: **{available_stock} unidades**.",
    quantityBelowMinimum:
      "⚠️💠 A LivePix aceita Pix a partir de **{minimum_pix}**. Escolha no mínimo **{minimum_quantity} unidades** (total de **{minimum_total}**).",
    interactionConflict: "♻️🧾 Essa interação já foi usada em outro pedido.",
    storeUnavailable:
      "🛠️ A loja está se preparando agora. ✨ Tente novamente em alguns instantes! ⏳",
    productLoadFailure:
      "🛠️ Não conseguimos carregar esse produto agora. ✨ Tente novamente em alguns instantes! ⏳",
    purchaseFailure:
      "🛡️ Não foi possível criar o pedido. Fique tranquilo: nenhum item foi entregue ou revelado. 🔒",
    outsideServer:
      "🏰 A compra precisa ser iniciada dentro do servidor Discord usando o botão da loja. 🛍️",
  },
  ticket: {
    title: "Pagamento confirmado",
    description:
      "Seu pagamento foi confirmado. Este ticket é privado; aguarde o atendimento e a entrega do produto.",
    productLabel: "Produto",
    quantityLabel: "Quantidade",
    amountLabel: "Valor",
    orderLabel: "Pedido",
  },
};

export const BOT_MESSAGE_FIELD_LIMITS = {
  "storefront.title": 256,
  "storefront.paginatedTitle": 256,
  "storefront.subtitle": 256,
  "storefront.welcome": 500,
  "storefront.catalogText": 500,
  "storefront.privacyText": 500,
  "storefront.paymentText": 500,
  "storefront.prompt": 500,
  "storefront.selectLabel": 100,
  "storefront.selectPlaceholder": 150,
  "storefront.emptyTitle": 256,
  "storefront.emptyText": 1_000,
  "storefront.emptyHint": 1_000,
  "product.title": 256,
  "product.subtitle": 256,
  "product.selectedText": 500,
  "product.priceText": 500,
  "product.stockText": 500,
  "product.minimumText": 500,
  "product.invalidPriceText": 500,
  "product.deliveryText": 500,
  "product.privacyText": 500,
  "product.buttonLabel": 80,
  "product.insufficientStockText": 500,
  "product.outOfStockText": 500,
  "quantity.modalTitle": 45,
  "quantity.inputLabel": 45,
  "quantity.inputPlaceholder": 100,
  "quantity.unavailableText": 1_000,
  "quantity.invalidPriceText": 1_000,
  "quantity.insufficientStockText": 1_000,
  "order.createdTitle": 256,
  "order.duplicateTitle": 256,
  "order.subtitle": 256,
  "order.productLabel": 256,
  "order.unitPriceLabel": 256,
  "order.subtotalLabel": 256,
  "order.discountLabel": 256,
  "order.totalLabel": 256,
  "order.orderIdLabel": 256,
  "order.statusText": 500,
  "order.paymentPrompt": 500,
  "order.paymentButtonLabel": 80,
  "order.ticketText": 500,
  "order.privacyText": 500,
  "order.protectedText": 500,
  "help.title": 256,
  "help.subtitle": 256,
  "help.body": 3_000,
  "error.title": 256,
  "error.subtitle": 256,
  "error.retryText": 500,
  "error.invalidRequest": 1_000,
  "error.invalidQuantity": 1_000,
  "error.guildNotAuthorized": 1_000,
  "error.productUnavailable": 1_000,
  "error.outOfStock": 1_000,
  "error.insufficientStock": 1_000,
  "error.quantityBelowMinimum": 1_000,
  "error.interactionConflict": 1_000,
  "error.storeUnavailable": 1_000,
  "error.productLoadFailure": 1_000,
  "error.purchaseFailure": 1_000,
  "error.outsideServer": 1_000,
  "ticket.title": 256,
  "ticket.description": 4_096,
  "ticket.productLabel": 256,
  "ticket.quantityLabel": 256,
  "ticket.amountLabel": 256,
  "ticket.orderLabel": 256,
} as const satisfies Record<string, number>;

export const BOT_MESSAGE_TOKEN_ALLOWLIST: Record<string, readonly string[]> = {
  "storefront.paginatedTitle": ["page", "pages"],
  "product.title": ["product_emoji", "product_name"],
  "product.subtitle": ["game_name", "substore_title"],
  "product.priceText": ["price"],
  "product.stockText": ["stock"],
  "product.minimumText": ["minimum_quantity", "minimum_total"],
  "product.insufficientStockText": ["minimum_quantity"],
  "quantity.inputLabel": ["minimum_quantity"],
  "quantity.inputPlaceholder": ["minimum_quantity", "maximum_quantity"],
  "quantity.insufficientStockText": ["minimum_quantity"],
  "order.discountLabel": ["discount_percent"],
  "error.invalidQuantity": ["maximum_quantity"],
  "error.insufficientStock": ["available_stock"],
  "error.quantityBelowMinimum": ["minimum_pix", "minimum_quantity", "minimum_total"],
};

export function normalizeBotMessageCustomization(value: Json | unknown): BotMessageCustomization {
  const root = asRecord(value);
  return {
    version: BOT_MESSAGE_CONFIG_VERSION,
    storefront: normalizeSection(root.storefront, DEFAULT_BOT_MESSAGE_CUSTOMIZATION.storefront),
    product: normalizeSection(root.product, DEFAULT_BOT_MESSAGE_CUSTOMIZATION.product),
    quantity: normalizeSection(root.quantity, DEFAULT_BOT_MESSAGE_CUSTOMIZATION.quantity),
    order: normalizeSection(root.order, DEFAULT_BOT_MESSAGE_CUSTOMIZATION.order),
    help: normalizeSection(root.help, DEFAULT_BOT_MESSAGE_CUSTOMIZATION.help),
    error: normalizeSection(root.error, DEFAULT_BOT_MESSAGE_CUSTOMIZATION.error),
    ticket: normalizeSection(root.ticket, DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket),
  };
}

export function botMessageCustomizationToJson(value: BotMessageCustomization): JsonObject {
  return value as unknown as JsonObject;
}

export function interpolateBotMessage(
  template: string,
  tokens: Record<string, string | number>,
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? String(tokens[name]) : match,
  );
}

export function interpolateBotMessageLimited(
  template: string,
  tokens: Record<string, string | number>,
  maximum: number,
): string {
  const value = interpolateBotMessage(template, tokens);
  if (value.length <= maximum) return value;
  if (maximum <= 3) return value.slice(0, maximum);
  return `${value.slice(0, maximum - 3).trimEnd()}...`;
}

export function botMessageLines(value: string): string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeSection<T extends Record<string, string>>(value: unknown, defaults: T): T {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof record[key] === "string" ? record[key] : fallback,
    ]),
  ) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
