import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brand: { isGwStore: true },
  emailAction: vi.fn(),
  bridge: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return mocks.brand.isGwStore; }, STORE_NAME: "GWStore" }));
vi.mock("@/lib/env", () => ({ getSiteUrl: () => "https://gwstoreofc.com" }));
vi.mock("@/lib/customer-auth-origin", () => ({ redirectCustomerAuthToLoginHost: mocks.bridge }));
vi.mock("./actions", () => ({ customerEmailAuth: mocks.emailAction }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/layout/brand-mark", () => ({ BrandMark: () => <span aria-hidden="true">GW</span> }));

import CustomerLoginPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brand.isGwStore = true;
  mocks.bridge.mockResolvedValue(undefined);
});

describe("página de acesso do cliente", () => {
  it("oferece Google, Discord e email mantendo o carrinho em todos os destinos", async () => {
    const next = "/?checkout=1&cart=%5B%7B%22productId%22%3A%22dragon%22%2C%22quantity%22%3A2%7D%5D";
    render(await CustomerLoginPage({ searchParams: Promise.resolve({ next, erro: "oauth" }) }));
    expect(screen.getByRole("heading", { name: "Entre para concluir a compra" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Seu carrinho foi preservado");
    const google = new URL(screen.getByRole("link", { name: "Continuar com Google" }).getAttribute("href")!, "https://gwstoreofc.com");
    expect(google.pathname).toBe("/auth/google/login");
    expect(google.searchParams.get("customer")).toBe("1");
    expect(google.searchParams.get("next")).toBe(next);
    const discord = new URL(screen.getByRole("link", { name: "Continuar com Discord" }).getAttribute("href")!, "https://gwstoreofc.com");
    expect(discord.pathname).toBe("/auth/login");
    expect(discord.searchParams.get("next")).toBe(next);
    expect(screen.getByRole("link", { name: "Voltar à loja" })).toHaveAttribute("href", next);
    expect(mocks.bridge).toHaveBeenCalledWith(next, { mode: undefined, erro: "oauth", setup: undefined });
    expect(mocks.emailAction).not.toHaveBeenCalled();
  });

  it("abre cadastro e normaliza destino externo antes da ponte de autenticação", async () => {
    render(await CustomerLoginPage({ searchParams: Promise.resolve({ next: "https://evil.example", mode: "signup" }) }));
    expect(screen.getByRole("heading", { name: "Crie sua conta" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Criar conta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Confirmar senha")).toBeRequired();
    expect(screen.getByRole("link", { name: "Voltar à loja" })).toHaveAttribute("href", "/");
    expect(mocks.bridge).toHaveBeenCalledWith("/", { mode: "signup", erro: undefined, setup: undefined });
  });

  it("abre a definição de nova senha do callback sem solicitar email ou provedores", async () => {
    render(await CustomerLoginPage({ searchParams: Promise.resolve({ mode: "reset", next: "/minhas-compras" }) }));
    expect(screen.getByRole("heading", { name: "Crie uma nova senha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar nova senha" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continuar com Google" })).not.toBeInTheDocument();
    expect(mocks.emailAction).not.toHaveBeenCalled();
  });

  it("mantém a página exclusiva da GWStore", async () => {
    mocks.brand.isGwStore = false;
    await expect(CustomerLoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.bridge).not.toHaveBeenCalled();
    expect(mocks.emailAction).not.toHaveBeenCalled();
  });
});
