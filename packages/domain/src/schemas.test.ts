import { describe, expect, it } from "vitest";

import {
  CATALOG_STATUSES,
  INVENTORY_UNIT_STATUSES,
  ORDER_STATUSES,
  commissionBpsSchema,
  discordIdSchema,
  gameInputSchema,
  hexColorSchema,
  moneyCentsSchema,
  platformSettingsSchema,
  productInputSchema,
  substoreInputSchema,
  whitelistEntryInputSchema,
} from "./index";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("schemas comuns", () => {
  it("mantém IDs do Discord como strings", () => {
    const discordId = "123456789012345678";
    expect(discordIdSchema.parse(` ${discordId} `)).toBe(discordId);
    expect(typeof discordIdSchema.parse(discordId)).toBe("string");
    expect(discordIdSchema.safeParse(123456789012345678n).success).toBe(false);
    expect(discordIdSchema.safeParse("1234").success).toBe(false);
    expect(discordIdSchema.safeParse("12345678901234567a").success).toBe(false);
  });

  it("aceita somente centavos inteiros, seguros e não negativos", () => {
    expect(moneyCentsSchema.parse(1_099)).toBe(1_099);
    expect(moneyCentsSchema.safeParse(-1).success).toBe(false);
    expect(moneyCentsSchema.safeParse(10.5).success).toBe(false);
    expect(moneyCentsSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  it("limita comissão ao intervalo de zero a 10000 pontos-base", () => {
    expect(commissionBpsSchema.parse(3_000)).toBe(3_000);
    expect(commissionBpsSchema.safeParse(-1).success).toBe(false);
    expect(commissionBpsSchema.safeParse(10_001).success).toBe(false);
    expect(commissionBpsSchema.safeParse(50.5).success).toBe(false);
  });

  it("normaliza cor hexadecimal", () => {
    expect(hexColorSchema.parse("#d4af37")).toBe("#D4AF37");
    expect(hexColorSchema.safeParse("gold").success).toBe(false);
  });

  it("expõe listas imutáveis dos estados suportados", () => {
    expect(CATALOG_STATUSES).toEqual(["active", "inactive", "archived"]);
    expect(INVENTORY_UNIT_STATUSES).toContain("quarantined");
    expect(ORDER_STATUSES).toContain("delivered");
  });
});

describe("schemas de catálogo", () => {
  it("aplica defaults seguros a um jogo", () => {
    expect(
      gameInputSchema.parse({
        name: " Counter-Strike 2 ",
        slug: "counter-strike-2",
      }),
    ).toEqual({
      name: "Counter-Strike 2",
      slug: "counter-strike-2",
      description: null,
      imageUrl: null,
      status: "active",
      sortOrder: 0,
    });
  });

  it("valida subloja e seus metadados visuais", () => {
    const parsed = substoreInputSchema.parse({
      gameId: uuid,
      name: "Skins",
      slug: "skins",
      title: "Skins premium",
      description: "Escolha o item desejado.",
      color: "#abcdef",
    });

    expect(parsed.color).toBe("#ABCDEF");
    expect(parsed.imageUrl).toBeNull();
    expect(parsed.status).toBe("active");
  });

  it("valida produto com preço mínimo em centavos e estoque calculado fora do input", () => {
    const parsed = productInputSchema.parse({
      substoreId: uuid,
      name: "AWP Asiimov",
      slug: "awp-asiimov",
      minimumPriceCents: 10_00,
    });

    expect(parsed.minimumPriceCents).toBe(1_000);
    expect(parsed.lowStockThreshold).toBe(5);
    expect("availableStock" in parsed).toBe(false);
    expect(productInputSchema.safeParse({ ...parsed, minimumPriceCents: -1 }).success).toBe(false);
  });

  it("rejeita slugs e URLs inválidos", () => {
    expect(
      gameInputSchema.safeParse({ name: "Jogo", slug: "Slug Com Espaço" }).success,
    ).toBe(false);
    expect(
      substoreInputSchema.safeParse({
        gameId: uuid,
        name: "Loja",
        slug: "loja",
        title: "Loja",
        description: "Descrição",
        imageUrl: "não-é-url",
      }).success,
    ).toBe(false);
  });
});

describe("schemas de configuração", () => {
  it("aceita exceção nula ou explícita de comissão na whitelist", () => {
    const base = whitelistEntryInputSchema.parse({ discordId: "123456789012345678" });
    expect(base.commissionOverrideBps).toBeNull();
    expect(base.active).toBe(true);

    const override = whitelistEntryInputSchema.parse({
      discordId: "123456789012345678",
      commissionOverrideBps: 2_500,
    });
    expect(override.commissionOverrideBps).toBe(2_500);
  });

  it("fixa a moeda da plataforma em BRL", () => {
    expect(platformSettingsSchema.parse({ globalCommissionBps: 3_000 })).toEqual({
      currency: "BRL",
      globalCommissionBps: 3_000,
    });
    expect(
      platformSettingsSchema.safeParse({ currency: "USD", globalCommissionBps: 3_000 }).success,
    ).toBe(false);
  });
});
