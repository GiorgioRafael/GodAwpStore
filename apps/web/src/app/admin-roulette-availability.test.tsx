import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaders = vi.hoisted(() => ({
  overlay: vi.fn(), metrics: vi.fn(), wheel: vi.fn(), promotion: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: loaders.notFound }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: loaders.createServerSupabaseClient }));
vi.mock("@/app/actions/roulette-redemptions", () => ({
  settleRouletteRedemptionAction: vi.fn(), retryRouletteRedemptionTicketAction: vi.fn(),
  syncRouletteRedemptionControlsAction: vi.fn(),
}));
vi.mock("@/lib/roulette/overlay-link", () => ({ getRouletteOverlayLink: loaders.overlay }));
vi.mock("@/lib/roulette/metrics", () => ({ getRouletteMetrics: loaders.metrics, hasPlayerActivity: () => false }));
vi.mock("@/lib/roulette/wheel-admin", () => ({ getRouletteWheelAdmin: loaders.wheel }));
vi.mock("@/lib/roulette/promotion-admin", () => ({ getRoulettePromotionSettings: loaders.promotion }));
vi.mock("@/components/admin/roulette-metrics-panel", () => ({ RouletteMetricsPanel: () => null }));
vi.mock("@/components/admin/roulette-power-switch", () => ({ RoulettePowerSwitch: () => null }));
vi.mock("@/components/admin/roulette-wheel-editor", () => ({ RouletteWheelEditor: () => null }));
vi.mock("@/components/admin/roulette-overlay-link", () => ({ RouletteOverlayLink: () => null }));
vi.mock("@/components/admin/roulette-promotion-editor", () => ({ RoulettePromotionEditor: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  loaders.overlay.mockResolvedValue({ status: "forbidden" });
  loaders.metrics.mockResolvedValue(null);
  loaders.wheel.mockResolvedValue({ ok: false, reason: "fixture" });
  loaders.promotion.mockResolvedValue({ settings: {} });
  const query = {
    select: vi.fn(), order: vi.fn(), limit: vi.fn(async () => ({ data: [{
      id: "10000000-0000-4000-8000-000000000001", discord_user_id: "player", item_count: 1,
      total_value_cents: 1_000, status: "pending", discord_ticket_status: "open",
      discord_ticket_channel_id: "ticket", discord_ticket_error: null, game_nickname: "Jogador",
      created_at: "2026-10-01T12:00:00Z", guilds: { discord_guild_id: "guild" },
      roulette_redemption_items: [{ prize_key: "premio_1", product_name: "Dragon", quantity: 1, value_cents: 1_000, products: { stock_quantity: 5 } }],
    }], error: null })),
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  loaders.createServerSupabaseClient.mockResolvedValue({ from: vi.fn(() => query) });
});
afterEach(() => vi.unstubAllEnvs());

describe("acessos administrativos da roleta por marca", () => {
  it.each(["GWStore", "GodAwp Store"])("oculta menu e login e impede leitura das configurações em %s", async storeName => {
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", storeName);
    vi.resetModules();
    const navigation = await import("@/components/layout/navigation");
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    const { default: MetricsPage } = await import("@/app/(admin)/metricas-roleta/page");
    expect(navigation.filterNavigationGroups("roleta")).toEqual([]);
    expect(navigation.navigationGroups.flatMap(group => group.items).some(item => /resgates|metricas-roleta/.test(item.href))).toBe(false);
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("link", { name: /roleta/i })).not.toBeInTheDocument();
    await expect(MetricsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    for (const loader of [loaders.overlay, loaders.metrics, loaders.wheel, loaders.promotion]) expect(loader).not.toHaveBeenCalled();
  });

  it("mantém o menu, login e configurações da THStore", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "THStore");
    vi.resetModules();
    const navigation = await import("@/components/layout/navigation");
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    const { default: MetricsPage } = await import("@/app/(admin)/metricas-roleta/page");
    const hrefs = navigation.navigationGroups.flatMap(group => group.items).map(item => item.href);
    expect(hrefs).toContain("/resgates");
    expect(hrefs).toContain("/metricas-roleta");
    expect(hrefs).not.toContain("/atendimento-loja");
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: /Só quero jogar a roleta/i })).toHaveAttribute("href", "/roleta");
    await MetricsPage();
    for (const loader of [loaders.overlay, loaders.metrics, loaders.wheel, loaders.promotion]) expect(loader).toHaveBeenCalledOnce();
    expect(loaders.notFound).not.toHaveBeenCalled();
  });

  it("mantém atendimento direto dos prêmios GW existentes sem promover a roleta", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "GWStore");
    vi.resetModules();
    const { default: RedemptionsPage } = await import("@/app/(admin)/resgates/page");
    render(await RedemptionsPage());
    expect(screen.getByRole("heading", { name: "Prêmios pendentes" })).toBeInTheDocument();
    expect(screen.getByText("1x Dragon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entregue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar botões" })).toBeInTheDocument();
    expect(screen.queryByText(/roleta/i)).not.toBeInTheDocument();
  });
});
