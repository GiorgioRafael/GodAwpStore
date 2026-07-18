import { describe, expect, it, vi } from "vitest";

import { BotCommerceService } from "./commerce-service";
import type { BotCommerceRepository, DiscordGuildIdentity } from "./types";

const guild: DiscordGuildIdentity = {
  discordGuildId: "123456789012345678",
  ownerDiscordId: "223456789012345678",
  name: "Servidor GWStore",
};
const product = {
  id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
  name: "Dragon Breath",
  minimumPriceCents: 200,
};
const secondProduct = {
  id: "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
  name: "Super Sprinkler",
  minimumPriceCents: 300,
};
const input = {
  interactionId: "323456789012345678",
  buyerDiscordId: "423456789012345678",
  productId: product.id,
  quantity: 1,
  isServerBooster: false,
  guild,
};

const boosterDiscount = {
  enabled: true,
  discount_bps: 500,
  minimum_subtotal_cents: 5_000,
};

function repository(overrides: Partial<BotCommerceRepository> = {}) {
  const base: BotCommerceRepository = {
    listCatalog: vi.fn(async () => []),
    findOrderByInteraction: vi.fn(async () => null),
    ensureGuild: vi.fn(async () => ({
      id: "guild-row",
      whitelistEntryId: "whitelist-row",
      boosterDiscount,
    })),
    findPurchasableProduct: vi.fn(async () => product),
    countAvailableStock: vi.fn(async () => 2),
    getCommissionBps: vi.fn(async () => 1_000),
    createAwaitingPaymentOrder: vi.fn(async () => ({
      id: "order-row",
      status: "awaiting_payment" as const,
      created: true,
      outOfStock: false,
    })),
    findPurchaseByInteraction: vi.fn(async () => null),
    findPurchasableProducts: vi.fn(async (productIds) =>
      [product, secondProduct].filter((item) => productIds.includes(item.id)),
    ),
    countAvailableStocks: vi.fn(async (productIds: string[]) =>
      new Map(productIds.map((productId) => [productId, 10])),
    ),
    createAwaitingPaymentPurchase: vi.fn(async () => ({
      id: "cart-order-row",
      status: "awaiting_payment" as const,
      created: true,
      outOfStock: false,
    })),
  };
  return { ...base, ...overrides };
}

describe("BotCommerceService", () => {
  it("rejeita IDs inválidos antes de tocar no banco", async () => {
    const repo = repository();
    const service = new BotCommerceService(repo);

    await expect(service.purchase({ ...input, productId: "../../secret" })).resolves.toEqual({
      kind: "invalid_request",
    });
    expect(repo.ensureGuild).not.toHaveBeenCalled();
    expect(repo.createAwaitingPaymentOrder).not.toHaveBeenCalled();
  });

  it("não cria pedido quando o estoque está vazio", async () => {
    const repo = repository({ countAvailableStock: vi.fn(async () => 0) });
    const service = new BotCommerceService(repo);

    await expect(service.purchase(input)).resolves.toEqual({ kind: "out_of_stock" });
    expect(repo.createAwaitingPaymentOrder).not.toHaveBeenCalled();
  });

  it("bloqueia servidores cujo proprietário não está na allowlist", async () => {
    const repo = repository({
      ensureGuild: vi.fn(async () => ({
        id: "guild-row",
        whitelistEntryId: null,
        boosterDiscount,
      })),
    });
    const service = new BotCommerceService(repo);

    await expect(service.purchase(input)).resolves.toEqual({ kind: "guild_not_authorized" });
    expect(repo.createAwaitingPaymentOrder).not.toHaveBeenCalled();
  });

  it("cria pedido awaiting_payment com preço e comissão vindos do servidor", async () => {
    const repo = repository();
    const service = new BotCommerceService(repo);

    await expect(service.purchase(input)).resolves.toEqual({
      kind: "created",
      orderId: "order-row",
      productName: "Dragon Breath",
      quantity: 1,
      unitPriceCents: 200,
      subtotalPriceCents: 200,
      totalPriceCents: 200,
      discountBps: 0,
      discountAmountCents: 0,
      discountReason: null,
    });
    expect(repo.createAwaitingPaymentOrder).toHaveBeenCalledWith({
      interactionId: input.interactionId,
      guildId: "guild-row",
      whitelistEntryId: "whitelist-row",
      product,
      buyerDiscordId: input.buyerDiscordId,
      quantity: 1,
      subtotalPriceCents: 200,
      totalPriceCents: 200,
      discountBps: 0,
      discountAmountCents: 0,
      discountReason: null,
      commissionBps: 1_000,
    });
  });

  it("trata a perda atômica da última unidade como estoque esgotado", async () => {
    const repo = repository({
      createAwaitingPaymentOrder: vi.fn(async () => ({
        id: null,
        status: "awaiting_payment" as const,
        created: false,
        outOfStock: true,
      })),
    });
    const service = new BotCommerceService(repo);

    await expect(service.purchase(input)).resolves.toEqual({ kind: "out_of_stock" });
  });

  it("trata a repetição da mesma interação como idempotente", async () => {
    const repo = repository({
      findPurchasableProduct: vi.fn(async () => ({ ...product, minimumPriceCents: 500 })),
      findOrderByInteraction: vi.fn(async () => ({
        id: "order-existing",
        buyerDiscordId: input.buyerDiscordId,
        productId: input.productId,
        quantity: 1,
        unitPriceCents: 200,
        subtotalPriceCents: 200,
        salePriceCents: 200,
        discountBps: 0,
        discountAmountCents: 0,
        discountReason: null,
        status: "awaiting_payment",
      })),
    });
    const service = new BotCommerceService(repo);

    await expect(service.purchase(input)).resolves.toEqual({
      kind: "duplicate",
      orderId: "order-existing",
      productName: product.name,
      quantity: 1,
      unitPriceCents: 200,
      subtotalPriceCents: 200,
      totalPriceCents: 200,
      discountBps: 0,
      discountAmountCents: 0,
      discountReason: null,
    });
    expect(repo.ensureGuild).not.toHaveBeenCalled();
    expect(repo.createAwaitingPaymentOrder).not.toHaveBeenCalled();
  });

  it("bloqueia colisão de interação entre compradores", async () => {
    const repo = repository({
      findOrderByInteraction: vi.fn(async () => ({
        id: "order-existing",
        buyerDiscordId: "523456789012345678",
        productId: input.productId,
        quantity: 1,
        unitPriceCents: 200,
        subtotalPriceCents: 200,
        salePriceCents: 200,
        discountBps: 0,
        discountAmountCents: 0,
        discountReason: null,
        status: "awaiting_payment",
      })),
    });
    const service = new BotCommerceService(repo);

    await expect(service.purchase(input)).resolves.toEqual({ kind: "interaction_conflict" });
    expect(repo.createAwaitingPaymentOrder).not.toHaveBeenCalled();
  });

  it("exige quantidade suficiente para atingir o mínimo de R$ 1,00 da LivePix", async () => {
    const centProduct = { ...product, minimumPriceCents: 2 };
    const repo = repository({ findPurchasableProduct: vi.fn(async () => centProduct) });
    const service = new BotCommerceService(repo);

    await expect(service.purchase({ ...input, quantity: 49 })).resolves.toEqual({
      kind: "quantity_below_minimum",
      minimumQuantity: 50,
      minimumTotalCents: 100,
    });
    expect(repo.createAwaitingPaymentOrder).not.toHaveBeenCalled();
  });

  it("reserva a quantidade solicitada e calcula o total no servidor", async () => {
    const centProduct = { ...product, minimumPriceCents: 2 };
    const repo = repository({
      findPurchasableProduct: vi.fn(async () => centProduct),
      countAvailableStock: vi.fn(async () => 100),
    });
    const service = new BotCommerceService(repo);

    await expect(service.purchase({ ...input, quantity: 50 })).resolves.toMatchObject({
      kind: "created",
      quantity: 50,
      unitPriceCents: 2,
      totalPriceCents: 100,
    });
    expect(repo.createAwaitingPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 50, totalPriceCents: 100 }),
    );
  });

  it("aplica 5% para booster quando o subtotal atinge R$ 50", async () => {
    const boosterProduct = { ...product, minimumPriceCents: 2_500 };
    const repo = repository({
      findPurchasableProduct: vi.fn(async () => boosterProduct),
    });
    const service = new BotCommerceService(repo);

    await expect(
      service.purchase({ ...input, quantity: 2, isServerBooster: true }),
    ).resolves.toMatchObject({
      kind: "created",
      subtotalPriceCents: 5_000,
      discountBps: 500,
      discountAmountCents: 250,
      discountReason: "server_booster",
      totalPriceCents: 4_750,
    });
    expect(repo.createAwaitingPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        subtotalPriceCents: 5_000,
        discountBps: 500,
        discountAmountCents: 250,
        discountReason: "server_booster",
        totalPriceCents: 4_750,
      }),
    );
  });

  it("recalcula quantidade minima e total quando o admin altera o preco", async () => {
    let currentPriceCents = 2;
    const repo = repository({
      findPurchasableProduct: vi.fn(async () => ({
        ...product,
        minimumPriceCents: currentPriceCents,
      })),
      countAvailableStock: vi.fn(async () => 100),
    });
    const service = new BotCommerceService(repo);

    await expect(service.purchase({ ...input, quantity: 49 })).resolves.toMatchObject({
      kind: "quantity_below_minimum",
      minimumQuantity: 50,
    });

    currentPriceCents = 5;
    await expect(
      service.purchase({
        ...input,
        interactionId: "323456789012345679",
        quantity: 20,
      }),
    ).resolves.toMatchObject({
      kind: "created",
      quantity: 20,
      unitPriceCents: 5,
      totalPriceCents: 100,
    });
    expect(repo.createAwaitingPaymentOrder).toHaveBeenLastCalledWith(
      expect.objectContaining({
        product: expect.objectContaining({ minimumPriceCents: 5 }),
        quantity: 20,
        totalPriceCents: 100,
      }),
    );
  });

  it("informa o estoque disponível quando a quantidade solicitada é maior", async () => {
    const repo = repository({ countAvailableStock: vi.fn(async () => 2) });
    const service = new BotCommerceService(repo);

    await expect(service.purchase({ ...input, quantity: 3 })).resolves.toEqual({
      kind: "insufficient_stock",
      availableStock: 2,
    });
    expect(repo.createAwaitingPaymentOrder).not.toHaveBeenCalled();
  });

  it("cria um único checkout com vários produtos e preços calculados no servidor", async () => {
    const repo = repository();
    const service = new BotCommerceService(repo);

    await expect(
      service.purchaseCart({
        interactionId: input.interactionId,
        buyerDiscordId: input.buyerDiscordId,
        guild,
        isServerBooster: false,
        items: [
          { productId: product.id, quantity: 2 },
          { productId: secondProduct.id, quantity: 3 },
        ],
      }),
    ).resolves.toMatchObject({
      kind: "created",
      orderId: "cart-order-row",
      subtotalPriceCents: 1_300,
      totalPriceCents: 1_300,
      items: [
        { productId: product.id, quantity: 2, totalPriceCents: 400 },
        { productId: secondProduct.id, quantity: 3, totalPriceCents: 900 },
      ],
    });
    expect(repo.createAwaitingPaymentPurchase).toHaveBeenCalledWith({
      interactionId: input.interactionId,
      guildId: "guild-row",
      whitelistEntryId: "whitelist-row",
      buyerDiscordId: input.buyerDiscordId,
      items: [
        { productId: product.id, quantity: 2 },
        { productId: secondProduct.id, quantity: 3 },
      ],
      discountBps: 0,
      discountReason: null,
      commissionBps: 1_000,
    });
  });

  it("aplica o mínimo da LivePix sobre o total do carrinho", async () => {
    const cheapProducts = [
      { ...product, minimumPriceCents: 40 },
      { ...secondProduct, minimumPriceCents: 60 },
    ];
    const repo = repository({
      findPurchasableProducts: vi.fn(async () => cheapProducts),
    });
    const service = new BotCommerceService(repo);

    await expect(
      service.purchaseCart({
        interactionId: input.interactionId,
        buyerDiscordId: input.buyerDiscordId,
        guild,
        isServerBooster: false,
        items: cheapProducts.map((item) => ({ productId: item.id, quantity: 1 })),
      }),
    ).resolves.toMatchObject({ kind: "created", totalPriceCents: 100 });
  });

  it("informa qual produto do carrinho ficou com estoque insuficiente", async () => {
    const repo = repository({
      countAvailableStocks: vi.fn(async () =>
        new Map([
          [product.id, 10],
          [secondProduct.id, 1],
        ]),
      ),
    });
    const service = new BotCommerceService(repo);

    await expect(
      service.purchaseCart({
        interactionId: input.interactionId,
        buyerDiscordId: input.buyerDiscordId,
        guild,
        isServerBooster: false,
        items: [
          { productId: product.id, quantity: 1 },
          { productId: secondProduct.id, quantity: 2 },
        ],
      }),
    ).resolves.toEqual({
      kind: "insufficient_stock",
      productName: secondProduct.name,
      availableStock: 1,
    });
    expect(repo.createAwaitingPaymentPurchase).not.toHaveBeenCalled();
  });

  it("distribui o desconto de booster sem alterar o total do carrinho", async () => {
    const expensiveProducts = [
      { ...product, minimumPriceCents: 2_500 },
      { ...secondProduct, minimumPriceCents: 2_501 },
    ];
    const repo = repository({
      findPurchasableProducts: vi.fn(async () => expensiveProducts),
    });
    const service = new BotCommerceService(repo);

    const result = await service.purchaseCart({
      interactionId: input.interactionId,
      buyerDiscordId: input.buyerDiscordId,
      guild,
      isServerBooster: true,
      items: expensiveProducts.map((item) => ({ productId: item.id, quantity: 1 })),
    });

    expect(result).toMatchObject({
      kind: "created",
      subtotalPriceCents: 5_001,
      discountBps: 500,
      discountAmountCents: 250,
      totalPriceCents: 4_751,
    });
    if (result.kind === "created") {
      expect(result.items.reduce((sum, item) => sum + item.totalPriceCents, 0)).toBe(4_751);
    }
  });
});
