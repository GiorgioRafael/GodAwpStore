import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brand: { isGwStore: true },
  requireAdmin: vi.fn(),
  dashboard: vi.fn(),
}));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return mocks.brand.isGwStore; }, STORE_NAME: "GWStore" }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/app/(admin)/dashboard/page", () => ({ default: mocks.dashboard }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <section aria-label="Painel autenticado">{children}</section> }));
vi.mock("@/components/layout/brand-mark", () => ({ BrandMark: () => <span>Logo GWStore</span> }));

import HomePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brand.isGwStore = true;
  mocks.requireAdmin.mockResolvedValue({ displayName: "Admin", discordId: "123" });
  mocks.dashboard.mockResolvedValue(<p>Dados privados da loja</p>);
});

describe("home reservada para a loja", () => {
  it("abre a preparação da GWStore sem autenticar nem carregar dados administrativos", async () => {
    render(await HomePage());
    expect(screen.getByRole("heading", { name: "Nova loja em preparação" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Área administrativa" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByText("Dados privados da loja")).not.toBeInTheDocument();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });

  it("mantém a home autenticada das outras lojas", async () => {
    mocks.brand.isGwStore = false;
    render(await HomePage());
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.dashboard).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "Painel autenticado" })).toHaveTextContent("Dados privados da loja");
    expect(screen.queryByRole("heading", { name: "Nova loja em preparação" })).not.toBeInTheDocument();
  });

  it("não carrega dados privados das outras lojas antes da autorização", async () => {
    mocks.brand.isGwStore = false;
    mocks.requireAdmin.mockRejectedValueOnce(new Error("login obrigatório"));
    await expect(HomePage()).rejects.toThrow("login obrigatório");
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
});
