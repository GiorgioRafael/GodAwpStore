import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogStoreRow, ProductRow } from "@/lib/data/admin-repository";
import { InventoryStoresManager } from "./inventory-stores-manager";

const moveCatalogProductsAction = vi.hoisted(() => vi.fn(async (formData: FormData) => {
  void formData;
  return {
    ok: true,
    message: "1 produto(s) e todo o estoque foram movidos.",
  };
}));

vi.mock("@/app/actions/admin", () => ({ moveCatalogProductsAction }));

const gameId = "10000000-0000-4000-8000-000000000001";
const sourceStoreId = "20000000-0000-4000-8000-000000000001";
const targetStoreId = "20000000-0000-4000-8000-000000000002";
const stores: CatalogStoreRow[] = [
  {
    id: sourceStoreId,
    game_id: gameId,
    name: "Mundo 1",
    slug: "mundo-1",
    banner_url: null,
    status: "active",
    is_default: true,
    sort_order: 0,
    archived_at: null,
    created_at: "2026-08-02T12:00:00.000Z",
    updated_at: "2026-08-02T12:00:00.000Z",
    games: { name: "Grow a Garden 2" },
  },
  {
    id: targetStoreId,
    game_id: gameId,
    name: "Mundo 2",
    slug: "mundo-2",
    banner_url: null,
    status: "active",
    is_default: false,
    sort_order: 1,
    archived_at: null,
    created_at: "2026-08-02T12:00:00.000Z",
    updated_at: "2026-08-02T12:00:00.000Z",
    games: { name: "Grow a Garden 2" },
  },
];
const product: ProductRow = {
  id: "30000000-0000-4000-8000-000000000001",
  substore_id: "40000000-0000-4000-8000-000000000001",
  catalog_store_id: sourceStoreId,
  name: "Dragon's Breath",
  slug: "dragons-breath",
  description: null,
  minimum_price_cents: 50,
  stock_quantity: 31,
  image_url: null,
  status: "active",
  sort_order: 0,
  low_stock_threshold: 5,
  archived_at: null,
  created_at: "2026-08-02T12:00:00.000Z",
  updated_at: "2026-08-02T12:00:00.000Z",
  catalog_stores: { name: "Mundo 1", game_id: gameId },
  substores: { name: "Seeds", games: { name: "Grow a Garden 2" } },
};

afterEach(() => {
  cleanup();
  moveCatalogProductsAction.mockClear();
});

describe("estoque por loja", () => {
  it("organiza em pastas e move o SKU com todo o estoque para outra loja", async () => {
    const user = userEvent.setup();
    render(<InventoryStoresManager stores={stores} products={[product]} />);

    expect(screen.getByRole("button", { name: /Mundo 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Dragon's Breath")).toBeInTheDocument();
    expect(screen.getByText("31")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Selecionar Dragon's Breath/ }));
    await user.click(screen.getByRole("button", { name: "Mover (1)" }));

    await waitFor(() => expect(moveCatalogProductsAction).toHaveBeenCalledTimes(1));
    const formData = moveCatalogProductsAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get("targetStoreId")).toBe(targetStoreId);
    expect(JSON.parse(String(formData.get("productIds")))).toEqual([product.id]);
    expect(await screen.findByText("Esta loja ainda está vazia")).toBeInTheDocument();
  });

  it("seleciona todos os produtos da loja de uma vez", async () => {
    const user = userEvent.setup();
    render(<InventoryStoresManager stores={stores} products={[product]} />);

    await user.click(screen.getByRole("button", { name: "Selecionar todos" }));
    expect(screen.getByRole("checkbox", { name: /Selecionar Dragon's Breath/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Mover (1)" })).toBeEnabled();
  });
});
