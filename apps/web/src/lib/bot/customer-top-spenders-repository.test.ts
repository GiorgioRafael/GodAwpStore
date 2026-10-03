import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { SupabaseTopSpendersRepository } from "./customer-top-spenders-repository";

type Client = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

function ledger(pages: Array<{ data: unknown[] | null; error: { message: string } | null }>) {
  const query = {
    select: vi.fn(), in: vi.fn(), eq: vi.fn(), not: vi.fn(), lte: vi.fn(),
    order: vi.fn(), limit: vi.fn(), gt: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(pages.shift()).then(resolve),
  };
  for (const fn of [query.select, query.in, query.eq, query.not, query.lte, query.order, query.limit, query.gt]) fn.mockReturnValue(query);
  return query;
}

describe("fontes do Top 5", () => {
  it("lê produtos e Robux pagos, com escopo do servidor, sem truncar em 1.000 compras", async () => {
    const row = (id: string) => ({ id, guild_id: "gw", buyer_discord_id: "123456789012345678",
      sale_price_cents: 100, paid_at: "2026-10-01T00:00:00Z" });
    const products = ledger([
      { data: Array.from({ length: 1_000 }, (_, id) => row(String(id))), error: null },
      { data: [row("1000")], error: null },
    ]);
    const robux = ledger([{ data: [{ id: "robux", guild_id: "gw", buyer_discord_id: "123456789012345678",
      amount_cents: 200, paid_at: "2026-10-01T00:00:00Z" }], error: null }]);
    const client = { from: vi.fn((table: string) => table === "orders" ? products : robux) };
    const purchases = await new SupabaseTopSpendersRepository(client as unknown as Client).listPaidPurchases("gw");
    expect(purchases).toHaveLength(1002);
    expect(purchases.at(-1)).toMatchObject({ source: "robux", amountCents: 200 });
    expect(products.gt).toHaveBeenCalledWith("id", "999");
    for (const query of [products, robux]) {
      expect(query.eq).toHaveBeenCalledWith("guild_id", "gw");
      expect(query.eq).toHaveBeenCalledWith("payment_status", "paid");
      expect(query.in).toHaveBeenCalledWith("payment_provider", ["livepix", "eclipsepay"]);
      expect(query.not).toHaveBeenCalledWith("paid_at", "is", null);
    }
    expect(products.in).toHaveBeenCalledWith("status", ["paid", "processing", "delivered"]);
    expect(robux.eq).toHaveBeenCalledWith("status", "paid");
  });

  it("não retorna um ranking parcial se um dos dois históricos falhar", async () => {
    const products = ledger([{ data: [], error: null }]);
    const robux = ledger([{ data: null, error: { message: "internal database details" } }]);
    const client = { from: vi.fn((table: string) => table === "orders" ? products : robux) };
    await expect(new SupabaseTopSpendersRepository(client as unknown as Client).listPaidPurchases("gw"))
      .rejects.toThrow("pagamentos do Top 5");
  });
});
