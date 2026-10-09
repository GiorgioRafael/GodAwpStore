import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardOverview } from "./dashboard-overview";

const routingBrand = vi.hoisted(() => ({ isGwStore: true }));
vi.mock("@/lib/brand", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/brand")>(),
  get IS_GWSTORE() { return routingBrand.isGwStore; },
}));

describe("destinos dos acessos rápidos do painel", () => {
  it.each([[true, "/admin"], [false, ""]] as const)("mantém os destinos da loja e seus filtros (GW=%s)", (isGwStore, prefix) => {
    routingBrand.isGwStore = isGwStore;
    render(<DashboardOverview
      summary={{ gamesCount: 1, substoresCount: 1, productsCount: 1, availableUnitsCount: 0,
        lowStockProductsCount: 0, guildsCount: 1, ordersCount: 0, deliveredOrdersCount: 0,
        ledgerBalanceCents: 0, pendingPayoutsCents: 0 }}
      paidPix={{ paidOrdersCount: 0, grossRevenueCents: 0, grossRevenueTodayCents: 0,
        grossRevenueLast7DaysCents: 0, grossRevenueLast30DaysCents: 0, averageOrderCents: 0, lastPaidAt: null }}
      lowStock={[]} audit={[]}
    />);
    const destinations = [
      ["Ver pedidos de hoje", "/pedidos?period=today"],
      [/Acompanhar pedidos/, "/pedidos"],
      [/Repor estoque/, "/estoque"],
      [/Gerenciar produtos/, "/catalogo/produtos"],
      [/Publicar vitrines/, "/configuracoes#vitrines"],
      ["Ver histórico", "/auditoria"],
      ["Abrir estoque", "/estoque"],
    ] as const;
    for (const [name, destination] of destinations) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", `${prefix}${destination}`);
    }
  });
});
