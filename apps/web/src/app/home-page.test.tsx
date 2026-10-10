import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopCatalogGame } from "@/lib/shop/types";

const mocks = vi.hoisted(() => ({
  brand: { isGwStore: true },
  requireAdmin: vi.fn(),
  dashboard: vi.fn(),
  loadShopCatalog: vi.fn(),
  requireShopBuyer: vi.fn(),
}));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return mocks.brand.isGwStore; }, STORE_NAME: "GWStore" }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/shop/catalog", () => ({ loadShopCatalog: mocks.loadShopCatalog }));
vi.mock("@/lib/shop/request", () => ({ requireShopBuyer: mocks.requireShopBuyer }));
vi.mock("@/app/(admin)/dashboard/page", () => ({ default: mocks.dashboard }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <section aria-label="Painel autenticado">{children}</section> }));
vi.mock("@/components/layout/brand-mark", () => ({ BrandMark: () => <span>Logo GWStore</span> }));

import HomePage from "./page";

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const CATALOG: ShopCatalogGame[] = [{ id: "game", name: "Blox Fruits", catalogStoreName: "Frutas físicas", substores: [{
  id: "substore", name: "Frutas físicas", title: "Frutas", description: "", colorHex: "#ff00ff", imageUrl: null,
  products: [{ id: "10000000-0000-4000-8000-000000000001", name: "Dragon do catálogo", description: null,
    priceCents: 12_345, availableStock: 2, sortOrder: 1, isUpService: false, serviceRequirements: [] }],
}] }];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.clearAllMocks();
  mocks.brand.isGwStore = true;
  mocks.requireAdmin.mockResolvedValue({ displayName: "Admin", discordId: "123" });
  mocks.dashboard.mockResolvedValue(<p>Dados privados da loja</p>);
  mocks.loadShopCatalog.mockResolvedValue(CATALOG);
  mocks.requireShopBuyer.mockRejectedValue(new Error("sem sessão"));
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllEnvs();
});

describe("home pública da loja", () => {
  it("mostra catálogo do servidor em produção sem exigir administrador ou inventar preços", async () => {
    const user = userEvent.setup();
    vi.stubEnv("NODE_ENV", "production");
    render(await HomePage());
    expect(screen.queryByRole("heading", { name: "Dragon do catálogo" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Explorar Frutas físicas" }));
    expect(screen.getByRole("heading", { name: "Dragon do catálogo" })).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*123,45/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar na sua conta" })).toHaveAttribute("href", "/entrar");
    expect(screen.getByRole("link", { name: "Área administrativa" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByText("Dados privados da loja")).not.toBeInTheDocument();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.loadShopCatalog).toHaveBeenCalledOnce();
  });

  it("reconhece cliente autenticado sem exigir permissão administrativa", async () => {
    mocks.requireShopBuyer.mockResolvedValue({ displayName: "Cliente" });
    render(await HomePage());
    expect(screen.getByRole("link", { name: "Minhas compras" })).toHaveAttribute("href", "/minhas-compras");
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });

  it("mostra indisponibilidade se o catálogo falha, sem exibir dados de demonstração", async () => {
    mocks.loadShopCatalog.mockRejectedValue(new Error("banco indisponível"));
    render(await HomePage());
    expect(screen.getByRole("heading", { name: "O catálogo não carregou" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("mantém a home autenticada das outras lojas", async () => {
    mocks.brand.isGwStore = false;
    render(await HomePage());
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.dashboard).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "Painel autenticado" })).toHaveTextContent("Dados privados da loja");
    expect(mocks.loadShopCatalog).not.toHaveBeenCalled();
    expect(mocks.requireShopBuyer).not.toHaveBeenCalled();
  });

  it("não carrega dados privados das outras lojas antes da autorização", async () => {
    mocks.brand.isGwStore = false;
    mocks.requireAdmin.mockRejectedValueOnce(new Error("login obrigatório"));
    await expect(HomePage()).rejects.toThrow("login obrigatório");
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.loadShopCatalog).not.toHaveBeenCalled();
    expect(mocks.requireShopBuyer).not.toHaveBeenCalled();
  });
});
