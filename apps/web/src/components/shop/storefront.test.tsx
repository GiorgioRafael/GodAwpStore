import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShopCatalogGame, ShopCatalogProduct } from "@/lib/shop/types";
import { flattenShopCatalog } from "@/lib/shop/catalog-view";
import { CartCheckout } from "./cart-checkout";
import { Storefront } from "./storefront";

vi.mock("@/components/layout/brand-mark", () => ({ BrandMark: () => <span aria-hidden="true">Marca GW</span> }));

const DRAGON = "10000000-0000-4000-8000-000000000001";
const product = (id: string, name: string, priceCents: number, extras: Partial<ShopCatalogProduct> = {}): ShopCatalogProduct => ({
  id, name, description: "Entrega combinada no atendimento privado da compra.", priceCents,
  availableStock: 3, sortOrder: 1, isUpService: false, serviceRequirements: [], ...extras,
});
const CATALOG: ShopCatalogGame[] = [{
  id: "game", name: "Blox Fruits", catalogStoreName: "Blox Fruits",
  substores: [
    { id: "physical", name: "Frutas físicas", title: "Frutas", description: "", colorHex: "#ff00ff", imageUrl: null,
      products: [product(DRAGON, "Dragon West", 5_500, { imageUrl: "https://images.example/dragon.webp" }),
        product("20000000-0000-4000-8000-000000000002", "Yeti", 500, { availableStock: 0 })] },
    { id: "permanent", name: "Permanentes", title: "Permanentes", description: "", colorHex: "#ff00ff", imageUrl: null,
      products: [product("30000000-0000-4000-8000-000000000003", "Dough Permanente", 12_000)] },
    { id: "skin", name: "Skins", title: "Skins", description: "", colorHex: "#ff00ff", imageUrl: null,
      products: [product("40000000-0000-4000-8000-000000000004", "Kitsune Galaxy", 14_000)] },
    { id: "up", name: "Raças V4", title: "UP", description: "", colorHex: "#ff00ff", imageUrl: null,
      products: [product("50000000-0000-4000-8000-000000000005", "Raça V4", 1_500, { isUpService: true, unlimitedStock: true, availableStock: 0, serviceRequirements: ["Ter nível 2550"] })] },
  ],
}];
const request = vi.fn();

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", request);
  request.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("catálogo e carrinho da GWStore", () => {
  it("usa nomes, categorias e preços do catálogo e busca sem depender de acentos", async () => {
    const user = userEvent.setup();
    render(<Storefront catalog={CATALOG} buyerName={null} />);
    const catalog = screen.getByRole("region", { name: "Catálogo" });
    expect(within(catalog).getAllByRole("article")).toHaveLength(5);
    expect(screen.getByText(/R\$\s*55,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*140,00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skins", exact: true }));
    expect(within(catalog).getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Kitsune Galaxy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dragon West" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Todos", exact: true }));
    await user.type(screen.getByRole("searchbox", { name: "Buscar produtos" }), "raca v4");
    expect(within(catalog).getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Raça V4" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpar busca" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Ordenar produtos" }), "price-asc");
    expect(within(within(catalog).getAllByRole("article")[0]).getByRole("heading", { level: 3 })).toHaveTextContent("Yeti");
    expect(request).not.toHaveBeenCalled();
  });

  it("troca imagem ausente ou quebrada pela marca sem remover o produto", () => {
    render(<Storefront catalog={CATALOG} buyerName={null} />);
    const dragonCard = screen.getByRole("heading", { name: "Dragon West" }).closest("article")!;
    const image = within(dragonCard).getByRole("img", { name: "Dragon West" });
    expect(image).toHaveAttribute("src", "https://images.example/dragon.webp");
    fireEvent.error(image);
    expect(within(dragonCard).queryByRole("img", { name: "Dragon West" })).not.toBeInTheDocument();
    expect(within(dragonCard).getByText("Marca GW")).toBeInTheDocument();
    const skinCard = screen.getByRole("heading", { name: "Kitsune Galaxy" }).closest("article")!;
    expect(within(skinCard).getByText("Marca GW")).toBeInTheDocument();
  });

  it("abre o detalhe, respeita estoque e mantém carrinho de visitante com os valores atuais", async () => {
    const user = userEvent.setup();
    render(<Storefront catalog={CATALOG} buyerName={null} />);
    await user.click(screen.getByRole("button", { name: "Ver Dragon West" }));
    const detail = screen.getByRole("dialog", { name: "Dragon West" });
    const quantity = within(detail).getByRole("spinbutton", { name: "Quantidade" });
    fireEvent.change(quantity, { target: { value: "9" } });
    expect(quantity).toHaveValue(3);
    await user.click(within(detail).getByRole("button", { name: "Adicionar ao carrinho" }));
    const cart = screen.getByRole("dialog", { name: "Seu carrinho" });
    expect(within(cart).getByRole("spinbutton", { name: "Quantidade de Dragon West" })).toHaveValue(3);
    expect(within(cart).getAllByText(/R\$\s*165,00/).length).toBeGreaterThan(0);
    expect(within(cart).getByRole("heading", { name: "Entre para continuar" })).toBeInTheDocument();
    expect(within(cart).queryByRole("textbox", { name: "Seu usuário no Roblox" })).not.toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("gwstore.shop.cart.v1")!)).toEqual([{ productId: DRAGON, quantity: 3 }]));
    await user.click(within(cart).getByRole("button", { name: "Remover Dragon West" }));
    expect(within(cart).getByRole("heading", { name: "O carrinho está vazio" })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("restaura o carrinho do login sem aceitar preço da URL nem quantidade acima do estoque", async () => {
    const raw = JSON.stringify([{ productId: DRAGON, quantity: 999, priceCents: 1 }]);
    window.history.replaceState(null, "", `/?checkout=1&cart=${encodeURIComponent(raw)}`);
    render(<Storefront catalog={CATALOG} buyerName="Ana" />);
    const cart = await screen.findByRole("dialog", { name: "Seu carrinho" });
    expect(within(cart).getByRole("spinbutton", { name: "Quantidade de Dragon West" })).toHaveValue(3);
    expect(within(cart).getAllByText(/R\$\s*165,00/).length).toBeGreaterThan(0);
    expect(window.location.search).toBe("");
  });

  it("não permite adicionar item esgotado e explica falha de catálogo sem inventar produtos", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Storefront catalog={CATALOG} buyerName={null} />);
    await user.click(screen.getByRole("button", { name: "Ver Yeti" }));
    const detail = screen.getByRole("dialog", { name: "Yeti" });
    expect(within(detail).getByRole("button", { name: "Adicionar ao carrinho" })).toBeDisabled();
    expect(within(detail).getByText("Indisponível no momento")).toBeInTheDocument();
    unmount();
    render(<Storefront catalog={[]} buyerName={null} catalogUnavailable />);
    expect(screen.getByRole("heading", { name: "O catálogo não carregou" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("reutiliza a chave do checkout após resposta incerta e troca a chave quando o carrinho muda", async () => {
    const user = userEvent.setup();
    const products = flattenShopCatalog(CATALOG);
    const cart = [{ productId: DRAGON, quantity: 1 }];
    const props = { open: true, onClose: vi.fn(), cart, products, signedIn: true, onQuantity: vi.fn() };
    request.mockRejectedValueOnce(new Error("network"));
    request.mockImplementation(async () => new Response(JSON.stringify({ ok: false, error: { code: "checkout_pending", message: "O pedido ainda está sendo preparado." } }), { status: 503 }));
    const { rerender } = render(<CartCheckout {...props} />);
    await user.type(screen.getByRole("textbox", { name: "Seu usuário no Roblox" }), "Buyer_123");
    await user.click(screen.getByRole("button", { name: "Continuar para o pagamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("retomar o mesmo pedido");
    await user.click(screen.getByRole("button", { name: "Continuar para o pagamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ainda está sendo preparado");
    const first = JSON.parse(request.mock.calls[0][1].body);
    const retry = JSON.parse(request.mock.calls[1][1].body);
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(retry).toEqual(first);
    expect(first.items).toEqual(cart);
    expect(first).not.toHaveProperty("totalPriceCents");
    rerender(<CartCheckout {...props} cart={[{ productId: DRAGON, quantity: 2 }]} />);
    await user.click(screen.getByRole("button", { name: "Continuar para o pagamento" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    const changed = JSON.parse(request.mock.calls[2][1].body);
    expect(changed.requestId).not.toBe(first.requestId);
    expect(changed.items).toEqual([{ productId: DRAGON, quantity: 2 }]);
  });
});
