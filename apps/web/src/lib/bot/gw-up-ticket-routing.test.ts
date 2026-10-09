import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { brand, createAdminSupabaseClient, from, queryResult } = vi.hoisted(() => ({
  brand: { isGwStore: true },
  createAdminSupabaseClient: vi.fn(),
  from: vi.fn(),
  queryResult: vi.fn(),
}));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return brand.isGwStore; } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient }));

import { GW_UP_CATEGORIES, GW_UP_GUILD_ID, GW_UP_STORE_ID } from "./gw-up-catalog";
import { loadGwStoreOrderTicketKinds, resolveGwStoreOrderTicketKind } from "./gw-up-ticket-routing";

const ORDER_ID = "417805df-0000-4000-8000-000000000001";
const OTHER_ORDER_ID = "417805df-0000-4000-8000-000000000002";
const UP_PRODUCT_ID = GW_UP_CATEGORIES[0].services[0].id;
const NORMAL_PRODUCT_ID = "417805df-0000-4000-8000-000000000003";
type Query = { table: string; select?: string; filters: Record<string, unknown>; range?: number[] };
let queries: Query[];

function order(id = ORDER_ID, catalogStoreId: string | null = GW_UP_STORE_ID, productId = UP_PRODUCT_ID, guildId = GW_UP_GUILD_ID) {
  return { id, product_id: productId, product: { catalog_store_id: catalogStoreId }, guilds: { discord_guild_id: guildId } };
}
function item(productId: string, catalogStoreId: string | null, orderId = ORDER_ID) {
  return { order_id: orderId, product_id: productId, product: { catalog_store_id: catalogStoreId } };
}
function mockRows(orders: unknown[], items: unknown[]) {
  queryResult.mockImplementation(async ({ table }: Query) => ({ data: table === "orders" ? orders : items, error: null }));
}

beforeEach(() => {
  vi.clearAllMocks();
  brand.isGwStore = true;
  queries = [];
  createAdminSupabaseClient.mockReturnValue({ from });
  from.mockImplementation((table: string) => {
    const query: Query = { table, filters: {} };
    queries.push(query);
    const builder = {
      select: vi.fn((select: string) => { query.select = select; return builder; }),
      eq: vi.fn((column: string, value: unknown) => { query.filters[column] = value; return builder; }),
      in: vi.fn((column: string, value: unknown) => { query.filters[column] = value; return builder; }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => { query.range = [start, end]; return queryResult(query); }),
    };
    return builder;
  });
  mockRows([], []);
});

describe("classificação dos tickets UP da GWStore", () => {
  it("classifica todos os serviços do carrinho e mantém o carrinho misto em Compra", async () => {
    mockRows([order(), order(OTHER_ORDER_ID)], [
      item(UP_PRODUCT_ID, null),
      item(NORMAL_PRODUCT_ID, GW_UP_STORE_ID),
      item(UP_PRODUCT_ID, GW_UP_STORE_ID, OTHER_ORDER_ID),
      item(NORMAL_PRODUCT_ID, "catalogo-normal", OTHER_ORDER_ID),
    ]);
    const kinds = await loadGwStoreOrderTicketKinds(GW_UP_GUILD_ID, [ORDER_ID, OTHER_ORDER_ID]);
    expect([...kinds]).toEqual([[ORDER_ID, "up"], [OTHER_ORDER_ID, "purchase"]]);
    expect(queries[0].filters["guilds.discord_guild_id"]).toBe(GW_UP_GUILD_ID);
    expect(queries[1].filters.order_id).toEqual([ORDER_ID, OTHER_ORDER_ID]);
    expect(queries.some(query => Object.keys(query.filters).some(key => /status|archived|stock|name/.test(key)))).toBe(false);
  });

  it("usa produto principal somente em pedidos antigos sem order_items", async () => {
    mockRows([order(), order(OTHER_ORDER_ID, "catalogo-normal", NORMAL_PRODUCT_ID)], [
      item(NORMAL_PRODUCT_ID, "catalogo-normal", OTHER_ORDER_ID),
    ]);
    expect([...await loadGwStoreOrderTicketKinds(GW_UP_GUILD_ID, [ORDER_ID, OTHER_ORDER_ID])])
      .toEqual([[ORDER_ID, "up"], [OTHER_ORDER_ID, "purchase"]]);
    mockRows([order()], [item(NORMAL_PRODUCT_ID, "catalogo-normal")]);
    expect(await resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID)).toBe("purchase");
  });

  it("reconhece o catálogo UP e os IDs fixos, inclusive sem produto relacionado", async () => {
    mockRows([order(ORDER_ID, GW_UP_STORE_ID, NORMAL_PRODUCT_ID)], []);
    expect(await resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID)).toBe("up");
    mockRows([{ ...order(), product: null }], [{ ...item(UP_PRODUCT_ID, null), product: null }]);
    expect(await resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID)).toBe("up");
  });

  it("não usa unlimited_stock ou nome do produto como sinal de UP", async () => {
    mockRows([order(ORDER_ID, "catalogo-normal", NORMAL_PRODUCT_ID)], [
      { ...item(NORMAL_PRODUCT_ID, "catalogo-normal"), unlimited_stock: true, name: "Serviço UP geral" },
    ]);
    expect(await resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID)).toBe("purchase");
  });

  it("mantém pedidos ausentes (Robux) e pedidos de outro servidor em Compra", async () => {
    mockRows([order(OTHER_ORDER_ID, GW_UP_STORE_ID, UP_PRODUCT_ID, "900000000000000010")], []);
    expect([...await loadGwStoreOrderTicketKinds(GW_UP_GUILD_ID, [ORDER_ID, OTHER_ORDER_ID])])
      .toEqual([[ORDER_ID, "purchase"], [OTHER_ORDER_ID, "purchase"]]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("ignora THStore, outro servidor e lista vazia sem acessar o banco", async () => {
    brand.isGwStore = false;
    expect(await resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID)).toBe("purchase");
    brand.isGwStore = true;
    expect(await resolveGwStoreOrderTicketKind("900000000000000010", ORDER_ID)).toBe("purchase");
    expect(await loadGwStoreOrderTicketKinds(GW_UP_GUILD_ID, [])).toEqual(new Map());
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("normaliza e deduplica UUIDs antes da consulta", async () => {
    mockRows([order()], []);
    expect(await resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID.toUpperCase())).toBe("up");
    await loadGwStoreOrderTicketKinds(GW_UP_GUILD_ID, [ORDER_ID, ORDER_ID.toUpperCase()]);
    expect(queries.filter(query => query.table === "orders").map(query => query.filters.id))
      .toEqual([[ORDER_ID], [ORDER_ID]]);
  });

  it("consulta a página seguinte antes de decidir que todos os itens são UP", async () => {
    queryResult.mockImplementation(async (query: Query) => ({ data: query.table === "orders" ? [order()]
      : query.range?.[0] === 0 ? Array.from({ length: 500 }, () => item(UP_PRODUCT_ID, GW_UP_STORE_ID))
        : [item(NORMAL_PRODUCT_ID, "catalogo-normal")], error: null }));
    expect(await resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID)).toBe("purchase");
    expect(queries.filter(query => query.table === "order_items").map(query => query.range)).toEqual([[0, 499], [500, 999]]);
  });

  it("divide pedidos em lotes sem perder pedidos da última página", async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `417805df-0000-4000-8000-${String(index).padStart(12, "0")}`);
    queryResult.mockImplementation(async (query: Query) => ({ data: query.table === "orders"
      ? (query.filters.id as string[]).map(id => order(id)) : [], error: null }));
    const kinds = await loadGwStoreOrderTicketKinds(GW_UP_GUILD_ID, ids);
    expect([...kinds.values()]).toEqual(Array.from({ length: 201 }, () => "up"));
    expect(queries.filter(query => query.table === "orders").map(query => (query.filters.id as string[]).length))
      .toEqual([100, 100, 1]);
  });

  it.each(["orders", "order_items"])("falha antes da sincronização se a consulta %s falhar", async (failedTable) => {
    queryResult.mockImplementation(async (query: Query) => query.table === failedTable
      ? { data: null, error: { message: "banco indisponível" } }
      : { data: [order()], error: null });
    await expect(resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID)).rejects.toThrow("banco indisponível");
  });

  it("falha quando não há cliente admin configurado", async () => {
    createAdminSupabaseClient.mockReturnValue(null);
    await expect(resolveGwStoreOrderTicketKind(GW_UP_GUILD_ID, ORDER_ID)).rejects.toThrow("Supabase não configurado");
    expect(from).not.toHaveBeenCalled();
  });
});
