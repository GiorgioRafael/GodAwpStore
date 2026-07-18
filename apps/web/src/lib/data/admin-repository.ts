import "server-only";

import { requireAdmin } from "@/lib/auth";
import type { JsonObject, Tables, Views } from "@/lib/supabase/database.types";
import type { OrdersPeriodRange } from "@/lib/orders-period";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type DashboardSummary = {
  gamesCount: number;
  substoresCount: number;
  productsCount: number;
  availableUnitsCount: number;
  lowStockProductsCount: number;
  guildsCount: number;
  ordersCount: number;
  deliveredOrdersCount: number;
  ledgerBalanceCents: number;
  pendingPayoutsCents: number;
};

export type PaidPixMetrics = {
  paidOrdersCount: number;
  grossRevenueCents: number;
  grossRevenueTodayCents: number;
  grossRevenueLast7DaysCents: number;
  grossRevenueLast30DaysCents: number;
  averageOrderCents: number;
  lastPaidAt: string | null;
};

export type PaidOrderSummary = {
  paidOrdersCount: number;
  totalReceivedCents: number;
};

export type AdminOrder = Tables<"orders"> & {
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
  }>;
};

export type GameRow = Pick<
  Tables<"games">,
  | "id"
  | "name"
  | "slug"
  | "status"
  | "description"
  | "image_url"
  | "sort_order"
  | "archived_at"
  | "created_at"
  | "updated_at"
>;

export type SubstoreRow = Pick<
  Tables<"substores">,
  | "id"
  | "game_id"
  | "name"
  | "slug"
  | "title"
  | "description"
  | "color_hex"
  | "image_url"
  | "thumbnail_url"
  | "author_name"
  | "author_icon_url"
  | "footer_text"
  | "footer_icon_url"
  | "status"
  | "sort_order"
  | "archived_at"
  | "created_at"
  | "updated_at"
> & { games: Pick<Tables<"games">, "name"> | null };

export type ProductRow = Pick<
  Tables<"products">,
  | "id"
  | "substore_id"
  | "name"
  | "slug"
  | "description"
  | "minimum_price_cents"
  | "stock_quantity"
  | "image_url"
  | "status"
  | "sort_order"
  | "low_stock_threshold"
  | "archived_at"
  | "created_at"
  | "updated_at"
> & {
  substores: (Pick<Tables<"substores">, "name"> & {
    games: Pick<Tables<"games">, "name"> | null;
  }) | null;
};

export type ProductStockRow = Views<"product_stock_summary">;

export type InventoryUnitRow = Pick<
  Tables<"inventory_units">,
  | "id"
  | "product_id"
  | "batch_id"
  | "status"
  | "reservation_expires_at"
  | "delivered_at"
  | "revoked_at"
  | "revocation_reason"
  | "created_at"
  | "updated_at"
> & {
  products: Pick<Tables<"products">, "name"> | null;
  inventory_batches: Pick<Tables<"inventory_batches">, "source" | "import_method"> | null;
};

export type InventoryBatchRow = Pick<
  Tables<"inventory_batches">,
  "id" | "product_id" | "source" | "unit_count" | "archived_at" | "created_at"
> & {
  import_method: "manual" | "txt" | "csv";
  products: Pick<Tables<"products">, "name"> | null;
};

export type WhitelistRow = Pick<
  Tables<"whitelist_entries">,
  | "id"
  | "discord_id"
  | "label"
  | "notes"
  | "is_active"
  | "commission_override_bps"
  | "archived_at"
  | "created_at"
  | "updated_at"
>;

export type AuditRow = Pick<
  Tables<"audit_events">,
  | "id"
  | "actor_discord_user_id"
  | "action"
  | "entity_type"
  | "entity_id"
  | "created_at"
> & { metadata: JsonObject };

async function client() {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Supabase não configurado.");
  return supabase;
}

function toSafeNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isSafeInteger(number) ? number : 0;
}

function assertQuerySucceeded(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Não foi possível ${operation}.`);
}

function toImportMethod(value: string): InventoryBatchRow["import_method"] {
  if (value === "manual" || value === "txt" || value === "csv") return value;
  throw new Error("O lote possui um método de importação inválido.");
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const supabase = await client();
  const { data, error } = await supabase.from("admin_dashboard_summary").select("*").single();
  assertQuerySucceeded(error, "carregar o resumo administrativo");
  if (!data) throw new Error("O resumo administrativo não retornou dados.");

  return {
    gamesCount: toSafeNumber(data.games_count),
    substoresCount: toSafeNumber(data.substores_count),
    productsCount: toSafeNumber(data.products_count),
    availableUnitsCount: toSafeNumber(data.available_units_count),
    lowStockProductsCount: toSafeNumber(data.low_stock_products_count),
    guildsCount: toSafeNumber(data.guilds_count),
    ordersCount: toSafeNumber(data.orders_count),
    deliveredOrdersCount: toSafeNumber(data.delivered_orders_count),
    ledgerBalanceCents: toSafeNumber(data.ledger_balance_cents),
    pendingPayoutsCents: toSafeNumber(data.pending_payouts_cents),
  };
}

export async function getPaidPixMetrics(): Promise<PaidPixMetrics> {
  const supabase = await client();
  const { data, error } = await supabase.from("admin_paid_pix_metrics").select("*").single();
  assertQuerySucceeded(error, "carregar as métricas de vendas Pix");
  if (!data) throw new Error("As métricas de vendas Pix não retornaram dados.");

  return {
    paidOrdersCount: toSafeNumber(data.paid_orders_count),
    grossRevenueCents: toSafeNumber(data.gross_revenue_cents),
    grossRevenueTodayCents: toSafeNumber(data.gross_revenue_today_cents),
    grossRevenueLast7DaysCents: toSafeNumber(data.gross_revenue_last_7_days_cents),
    grossRevenueLast30DaysCents: toSafeNumber(data.gross_revenue_last_30_days_cents),
    averageOrderCents: toSafeNumber(data.average_order_cents),
    lastPaidAt: data.last_paid_at,
  };
}

export async function getPaidOrderSummary(
  period: OrdersPeriodRange,
): Promise<PaidOrderSummary> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("get_paid_order_summary", {
    p_created_from: period.from,
    p_created_to: period.to,
  });
  assertQuerySucceeded(error, "carregar o total recebido dos pedidos");
  const summary = data?.[0];

  return {
    paidOrdersCount: toSafeNumber(summary?.paid_orders_count),
    totalReceivedCents: toSafeNumber(summary?.total_received_cents),
  };
}

export async function listOrders(
  period: OrdersPeriodRange,
  limit = 500,
): Promise<AdminOrder[]> {
  const supabase = await client();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  let query = supabase.from("orders").select("*");

  if (period.from) query = query.gte("created_at", period.from);
  if (period.to) query = query.lt("created_at", period.to);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  assertQuerySucceeded(error, "carregar os pedidos");
  const orders = data ?? [];
  if (orders.length === 0) return [];

  const { data: itemRows, error: itemError } = await supabase
    .from("order_items")
    .select("order_id,position,product_id,quantity,products(name)")
    .in("order_id", orders.map((order) => order.id))
    .order("position");
  assertQuerySucceeded(itemError, "carregar os itens dos pedidos");

  const itemsByOrder = new Map<string, AdminOrder["items"]>();
  for (const item of itemRows ?? []) {
    const items = itemsByOrder.get(item.order_id) ?? [];
    items.push({
      productId: item.product_id,
      productName: item.products?.name ?? "Produto",
      quantity: toSafeNumber(item.quantity),
    });
    itemsByOrder.set(item.order_id, items);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) ?? [],
  }));
}

export async function listGames(): Promise<GameRow[]> {
  const supabase = await client();
  const { data, error } = await supabase.from("games").select("*").order("sort_order").order("name");
  assertQuerySucceeded(error, "carregar os jogos");
  return data ?? [];
}

export async function listSubstores(): Promise<SubstoreRow[]> {
  const supabase = await client();
  const { data, error } = await supabase
    .from("substores")
    .select("*, games(name)")
    .order("sort_order")
    .order("name");
  assertQuerySucceeded(error, "carregar as sublojas");
  return data ?? [];
}

export async function listProducts(): Promise<ProductRow[]> {
  const supabase = await client();
  const { data, error } = await supabase
    .from("products")
    .select("*, substores(name, games(name))")
    .order("sort_order")
    .order("name");
  assertQuerySucceeded(error, "carregar os produtos");
  return data ?? [];
}

export async function listProductStock(options?: { lowOnly?: boolean }): Promise<ProductStockRow[]> {
  const supabase = await client();
  let query = supabase.from("product_stock_summary").select("*").order("product_name");
  if (options?.lowOnly) query = query.eq("is_low_stock", true);
  const { data, error } = await query;
  assertQuerySucceeded(error, "carregar o resumo do estoque");
  return (data ?? []).map((row) => ({
    ...row,
    available_count: toSafeNumber(row.available_count),
    reserved_count: toSafeNumber(row.reserved_count),
    delivered_count: toSafeNumber(row.delivered_count),
    quarantined_count: toSafeNumber(row.quarantined_count),
    revoked_count: toSafeNumber(row.revoked_count),
    total_count: toSafeNumber(row.total_count),
  }));
}

export async function listInventoryUnits(limit = 100): Promise<InventoryUnitRow[]> {
  const supabase = await client();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const { data, error } = await supabase
    .from("inventory_units")
    .select(
      "id,product_id,batch_id,status,reservation_expires_at,delivered_at,revoked_at,revocation_reason,created_at,updated_at,products(name),inventory_batches(source,import_method)",
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  assertQuerySucceeded(error, "carregar as unidades do estoque");
  return data ?? [];
}

export async function listInventoryBatches(limit = 100): Promise<InventoryBatchRow[]> {
  const supabase = await client();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const { data, error } = await supabase
    .from("inventory_batches")
    .select("id,product_id,source,import_method,unit_count,archived_at,created_at,products(name)")
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  assertQuerySucceeded(error, "carregar os lotes do estoque");
  return (data ?? []).map((row) => ({
    ...row,
    import_method: toImportMethod(row.import_method),
    unit_count: toSafeNumber(row.unit_count),
  }));
}

export async function listWhitelist(): Promise<WhitelistRow[]> {
  const supabase = await client();
  const { data, error } = await supabase
    .from("whitelist_entries")
    .select("*")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });
  assertQuerySucceeded(error, "carregar a whitelist");
  return data ?? [];
}

export async function getPlatformSettings() {
  const supabase = await client();
  const { data, error } = await supabase.from("platform_settings").select("*").eq("id", 1).single();
  assertQuerySucceeded(error, "carregar as configurações globais");
  return data;
}

export async function listAuditEvents(limit = 100): Promise<AuditRow[]> {
  const supabase = await client();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const { data, error } = await supabase
    .from("audit_events")
    .select("id,actor_discord_user_id,action,entity_type,entity_id,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  assertQuerySucceeded(error, "carregar a auditoria");
  return (data ?? []).map((event) => ({
    ...event,
    metadata: isJsonObject(event.metadata) ? event.metadata : {},
  }));
}

type OperationalTable =
  | "guilds"
  | "orders"
  | "ledger_entries"
  | "payouts"
  | "whitelist_balances";

type OperationalRows =
  | Tables<"guilds">[]
  | Tables<"orders">[]
  | Tables<"ledger_entries">[]
  | Tables<"payouts">[]
  | Views<"whitelist_balances">[];

export function listOperationalRows(table: "guilds", limit?: number): Promise<Tables<"guilds">[]>;
export function listOperationalRows(table: "orders", limit?: number): Promise<Tables<"orders">[]>;
export function listOperationalRows(
  table: "ledger_entries",
  limit?: number,
): Promise<Tables<"ledger_entries">[]>;
export function listOperationalRows(table: "payouts", limit?: number): Promise<Tables<"payouts">[]>;
export function listOperationalRows(
  table: "whitelist_balances",
  limit?: number,
): Promise<Views<"whitelist_balances">[]>;
export async function listOperationalRows(
  table: OperationalTable,
  limit = 100,
): Promise<OperationalRows> {
  const supabase = await client();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);

  if (table === "whitelist_balances") {
    const { data, error } = await supabase.from(table).select("*").limit(safeLimit);
    assertQuerySucceeded(error, `carregar ${table}`);
    return data ?? [];
  }

  if (table === "guilds") {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(safeLimit);
    assertQuerySucceeded(error, `carregar ${table}`);
    return data ?? [];
  }

  if (table === "orders") {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(safeLimit);
    assertQuerySucceeded(error, `carregar ${table}`);
    return data ?? [];
  }

  if (table === "payouts") {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(safeLimit);
    assertQuerySucceeded(error, `carregar ${table}`);
    return data ?? [];
  }

  const { data, error } = await supabase
    .from("ledger_entries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  assertQuerySucceeded(error, `carregar ${table}`);
  return data ?? [];
}
