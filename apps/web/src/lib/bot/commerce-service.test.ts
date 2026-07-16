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
const input = {
  interactionId: "323456789012345678",
  buyerDiscordId: "423456789012345678",
  productId: product.id,
  guild,
};

function repository(overrides: Partial<BotCommerceRepository> = {}) {
  const base: BotCommerceRepository = {
    listCatalog: vi.fn(async () => []),
    findOrderByInteraction: vi.fn(async () => null),
    ensureGuild: vi.fn(async () => ({ id: "guild-row", whitelistEntryId: "whitelist-row" })),
    findPurchasableProduct: vi.fn(async () => product),
    countAvailableStock: vi.fn(async () => 2),
    getCommissionBps: vi.fn(async () => 1_000),
    createAwaitingPaymentOrder: vi.fn(async () => ({
      id: "order-row",
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
      ensureGuild: vi.fn(async () => ({ id: "guild-row", whitelistEntryId: null })),
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
      priceCents: 200,
    });
    expect(repo.createAwaitingPaymentOrder).toHaveBeenCalledWith({
      interactionId: input.interactionId,
      guildId: "guild-row",
      whitelistEntryId: "whitelist-row",
      product,
      buyerDiscordId: input.buyerDiscordId,
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
      findOrderByInteraction: vi.fn(async () => ({
        id: "order-existing",
        buyerDiscordId: input.buyerDiscordId,
        productId: input.productId,
        status: "awaiting_payment",
      })),
    });
    const service = new BotCommerceService(repo);

    await expect(service.purchase(input)).resolves.toEqual({
      kind: "duplicate",
      orderId: "order-existing",
      productName: product.name,
      priceCents: product.minimumPriceCents,
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
        status: "awaiting_payment",
      })),
    });
    const service = new BotCommerceService(repo);

    await expect(service.purchase(input)).resolves.toEqual({ kind: "interaction_conflict" });
    expect(repo.createAwaitingPaymentOrder).not.toHaveBeenCalled();
  });
});
