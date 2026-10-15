import { describe, expect, it } from "vitest";

import type { ShopCatalogGame, ShopCatalogProduct } from "./types";
import {
  flattenShopCatalog, shopPlaceholderWord, shopProductDescription, shopProductDisplayName, shopServiceHint,
} from "./catalog-view";

const product = (name: string, extras: Partial<ShopCatalogProduct> = {}): ShopCatalogProduct => ({
  id: "10000000-0000-4000-8000-000000000001", name, description: null, priceCents: 1_000,
  availableStock: 1, sortOrder: 1, isUpService: false, serviceRequirements: [], ...extras,
});

describe("nomes de exibição dos produtos", () => {
  it.each([
    ["MAGNETIC FISICA", "Magnetic Física"],
    ["Kitsune Fruit fisica", "Kitsune Fruit Física"],
    ["2x DROPS  - BLOX FRUITS", "2x Drops"],
    ["2X XP 1Hora - BLOXFRUITS", "2x XP 1Hora"],
    ["BARCOS RAPIDOS - BLOX FRUITS", "Barcos Rápidos"],
    ["ROBUX VIA PLUS", "Robux via Plus"],
    ["RABID ( SOB ENCOMENDA )", "Rabid (Sob Encomenda)"],
    ["NOTIFICADOR DE FRUTAS - BLOX FRUITS", "Notificador de Frutas"],
    ["T-REX PERMANENTE", "T-Rex Permanente"],
  ])("limpa %s", (raw, expected) => {
    expect(shopProductDisplayName(raw)).toBe(expected);
  });

  it.each([
    "CDK", "TTK com 2x Maestria", "SuperHuman", "Level 0–700",
    "Dragon West", "Yeti", "Dough Permanente", "Kitsune Galaxy", "Raça V4", "Dragon do catálogo",
  ])("mantém %s", name => {
    expect(shopProductDisplayName(name)).toBe(name);
  });
});

describe("catálogo achatado", () => {
  it("adiciona grupo e nome de exibição sem alterar o nome original", () => {
    const catalog: ShopCatalogGame[] = [{ id: "game", name: "Blox Fruits", catalogStoreName: "Blox Fruits", substores: [
      { id: "maestria", name: "UP · Maestria", title: "UP", description: "", colorHex: "#ff00ff", imageUrl: null,
        products: [product("MAESTRIA 600", { isUpService: true })] },
      { id: "v4", name: "Raças V4", title: "UP", description: "", colorHex: "#ff00ff", imageUrl: null,
        products: [product("Raça V4", { isUpService: true })] },
    ] }];
    const [maestria, race] = flattenShopCatalog(catalog);
    expect(maestria).toMatchObject({ category: "up", groupId: "maestria", groupName: "Maestria", groupAnchor: "grupo-maestria",
      name: "MAESTRIA 600", displayName: "Maestria 600" });
    expect(race).toMatchObject({ groupName: "Raças V4", groupAnchor: "grupo-v4", displayName: "Raça V4" });
  });
});

describe("textos auxiliares", () => {
  it("escolhe a palavra da arte sem a categoria repetida", () => {
    expect(shopPlaceholderWord({ category: "permanent", groupName: "Permanentes", displayName: "Rocket Permanente" })).toBe("Rocket");
    expect(shopPlaceholderWord({ category: "permanent", groupName: "Permanentes", displayName: "Diamond / Diamante Permanente" })).toBe("Diamond");
    expect(shopPlaceholderWord({ category: "up", groupName: "Maestria", displayName: "Maestria 600" })).toBe("Maestria");
  });

  it("mostra só dicas reais dos serviços", () => {
    expect(shopServiceHint({ description: null, serviceRequirements: ["Serviço completo. É necessário possuir Yama + Tushita."] }))
      .toBe("É necessário possuir Yama + Tushita.");
    expect(shopServiceHint({ description: "Confira com a equipe os detalhes de execução no atendimento.", serviceRequirements: [] })).toBeNull();
  });

  it("esconde descrições que só repetem o nome ou um requisito", () => {
    expect(shopProductDescription({ description: "Tiger Fruit Fisica", name: "Tiger Fruit Fisica", displayName: "Tiger Fruit Física", serviceRequirements: [] })).toBeNull();
    expect(shopProductDescription({ description: "Ter nível 2550", name: "Raça V4", displayName: "Raça V4", serviceRequirements: ["Ter nível 2550"] })).toBeNull();
    expect(shopProductDescription({ description: "Entrega no servidor privado.", name: "Yeti", displayName: "Yeti", serviceRequirements: [] }))
      .toBe("Entrega no servidor privado.");
  });
});
