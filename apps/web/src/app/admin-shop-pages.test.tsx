import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gw: true,
  getAdminSession: vi.fn(),
  workspace: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return mocks.gw; } }));
vi.mock("@/lib/auth", () => ({ getAdminSession: mocks.getAdminSession }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/components/admin/shop-orders-manager", () => ({ ShopOrdersManager: () => <div>Lista de pedidos web</div> }));
vi.mock("@/components/shop/order-workspace", () => ({ ShopOrderWorkspace: mocks.workspace }));

import ListPage from "@/app/(admin)/atendimento-loja/page";
import OrderPage from "@/app/(admin)/atendimento-loja/[orderId]/page";
const ORDER_ID = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gw = true;
  mocks.getAdminSession.mockResolvedValue({ status: "authorized", identity: { authUserId: "admin" } });
  mocks.workspace.mockImplementation(({ orderId }: { orderId: string }) => <div>Atendimento {orderId}</div>);
});

describe("páginas privadas dos pedidos do site", () => {
  it("valida sessão administrativa na própria página e fornece o workspace de staff", async () => {
    render(await OrderPage({ params: Promise.resolve({ orderId: ORDER_ID }) }));
    expect(mocks.getAdminSession).toHaveBeenCalledOnce();
    expect(mocks.workspace.mock.calls[0][0]).toMatchObject({ orderId: ORDER_ID, admin: true });
    expect(screen.getByRole("link", { name: "Pedidos da loja" })).toHaveAttribute("href", "/admin/atendimento-loja");
  });

  it("a lista também valida sessão antes de expor a interface", async () => {
    render(await ListPage());
    expect(mocks.getAdminSession).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Pedidos da loja" })).toBeInTheDocument();
  });

  it("interrompe lista e detalhe para comprador sem autorização de admin", async () => {
    mocks.getAdminSession.mockResolvedValue({ status: "unauthorized", identity: { authUserId: "buyer" } });
    await expect(ListPage()).rejects.toThrow("NEXT_REDIRECT:/acesso-negado");
    await expect(OrderPage({ params: Promise.resolve({ orderId: ORDER_ID }) })).rejects.toThrow("NEXT_REDIRECT:/acesso-negado");
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("preserva o destino do pedido no login quando a sessão expira", async () => {
    mocks.getAdminSession.mockResolvedValue({ status: "unauthenticated", identity: null });
    await expect(OrderPage({ params: Promise.resolve({ orderId: ORDER_ID }) })).rejects.toThrow("NEXT_REDIRECT");
    const target = new URL(mocks.redirect.mock.calls[0][0], "https://gwstoreofc.com");
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("next")).toBe(`/admin/atendimento-loja/${ORDER_ID}`);
  });

  it("recusa IDs malformados e não disponibiliza essas páginas na THStore", async () => {
    await expect(OrderPage({ params: Promise.resolve({ orderId: "invalid" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getAdminSession).not.toHaveBeenCalled();
    mocks.gw = false;
    await expect(ListPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(OrderPage({ params: Promise.resolve({ orderId: ORDER_ID }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getAdminSession).not.toHaveBeenCalled();
  });
});
