import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShopCatalogGame, ShopCatalogProduct } from "@/lib/shop/types";
import { flattenShopCatalog } from "@/lib/shop/catalog-view";
import { CartCheckout } from "./cart-checkout";
import { Storefront } from "./storefront";

vi.mock("@/components/layout/brand-mark", () => ({ BrandMark: () => <span aria-hidden="true">Marca GW</span> }));
const routing = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));

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
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", request);
  request.mockReset();
  routing.push.mockReset();
});
afterEach(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("catálogo e carrinho da GWStore", () => {
  it("mostra somente as categorias disponíveis na página inicial", () => {
    render(<Storefront catalog={CATALOG} buyerName={null} />);
    const categories = screen.getByRole("region", { name: "Categorias" });
    expect(within(categories).getAllByRole("button", { name: /^Explorar / })).toHaveLength(4);
    for (const name of ["Frutas físicas", "Permanentes", "Skins", "Serviços de UP"]) {
      expect(within(categories).getByRole("button", { name: `Explorar ${name}` })).toBeInTheDocument();
    }
    expect(within(categories).queryByRole("button", { name: "Explorar Gamepasses" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Todos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dragon West" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kitsune Galaxy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Ordenar produtos" })).not.toBeInTheDocument();
  });

  it("busca pelo nome do produto na inicial sem mostrar produtos antes de escolher a categoria", async () => {
    await act(async () => { render(<Storefront catalog={CATALOG} buyerName={null} />); });
    const search = screen.getByRole("searchbox", { name: "Buscar categorias ou produtos" });
    fireEvent.change(search, { target: { value: "dragon west" } });
    const categories = screen.getByRole("region", { name: "Categorias" });
    expect(within(categories).getAllByRole("button", { name: /^Explorar / })).toHaveLength(1);
    expect(within(categories).getByRole("button", { name: "Explorar Frutas físicas" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dragon West" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "frutas permanentes" } });
    expect(within(categories).getAllByRole("button", { name: /^Explorar / })).toHaveLength(1);
    expect(within(categories).getByRole("button", { name: "Explorar Permanentes" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "dragon west" } });
    fireEvent.click(screen.getByRole("button", { name: "Explorar Frutas físicas" }));
    expect(screen.getByRole("heading", { name: "Dragon West" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kitsune Galaxy" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voltar às categorias" }));
    expect(search).toHaveValue("");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Categorias" })).getAllByRole("button", { name: /^Explorar / })).toHaveLength(4);
  });

  it("mostra produtos e preços somente dentro da categoria escolhida", async () => {
    await act(async () => { render(<Storefront catalog={CATALOG} buyerName={null} />); });
    fireEvent.click(screen.getByRole("button", { name: "Explorar Frutas físicas" }));
    const physical = screen.getByRole("region", { name: "Frutas físicas" });
    expect(within(physical).getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText(/R\$\s*55,00/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dough Permanente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kitsune Galaxy" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skins" }));
    const skins = screen.getByRole("region", { name: "Skins" });
    expect(within(skins).getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText(/R\$\s*140,00/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kitsune Galaxy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dragon West" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Todos" })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("busca sem depender de acentos e ordena produtos dentro da categoria", async () => {
    await act(async () => { render(<Storefront catalog={CATALOG} buyerName={null} />); });
    fireEvent.click(screen.getByRole("button", { name: "Explorar Serviços de UP" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "raca v4" } });
    const services = screen.getByRole("region", { name: "Serviços de UP" });
    expect(within(services).getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Raça V4" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(within(services).getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Frutas físicas" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Ordenar produtos" }), { target: { value: "price-asc" } });
    const physical = screen.getByRole("region", { name: "Frutas físicas" });
    expect(within(within(physical).getAllByRole("article")[0]).getByRole("heading", { level: 3 })).toHaveTextContent("Yeti");
    expect(request).not.toHaveBeenCalled();
  });

  it("mantém a busca e sua limpeza restritas à categoria selecionada", async () => {
    await act(async () => { render(<Storefront catalog={CATALOG} buyerName={null} />); });
    fireEvent.click(screen.getByRole("button", { name: "Explorar Frutas físicas" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kitsune" } });
    const physical = screen.getByRole("region", { name: "Frutas físicas" });
    expect(within(physical).queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kitsune Galaxy" })).not.toBeInTheDocument();
    const empty = screen.getByRole("heading", { name: "Nenhum produto encontrado" }).parentElement!;
    fireEvent.click(within(empty).getByRole("button", { name: "Limpar busca" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(within(physical).getAllByRole("article")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Kitsune Galaxy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver todos os produtos" })).not.toBeInTheDocument();
  });

  it("abre uma categoria pelo endereço e restaura a navegação do navegador", async () => {
    window.history.replaceState(null, "", "/?categoria=skin");
    await act(async () => { render(<Storefront catalog={CATALOG} buyerName={null} />); });
    const skins = screen.getByRole("region", { name: "Skins" });
    expect(within(skins).getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Kitsune Galaxy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dragon West" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Frutas físicas" }));
    expect(new URL(window.location.href).searchParams.get("categoria")).toBe("physical");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dragon" } });
    window.history.replaceState(null, "", "/?categoria=skin");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Kitsune Galaxy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dragon West" })).not.toBeInTheDocument();
    window.history.replaceState(null, "", "/");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByRole("region", { name: "Categorias" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("troca imagem ausente ou quebrada pela marca sem remover o produto", async () => {
    const user = userEvent.setup();
    render(<Storefront catalog={CATALOG} buyerName={null} />);
    await user.click(screen.getByRole("button", { name: "Explorar Frutas físicas" }));
    const dragonCard = screen.getByRole("heading", { name: "Dragon West" }).closest("article")!;
    const image = within(dragonCard).getByRole("img", { name: "Dragon West" });
    expect(image).toHaveAttribute("src", "https://images.example/dragon.webp");
    fireEvent.error(image);
    expect(within(dragonCard).queryByRole("img", { name: "Dragon West" })).not.toBeInTheDocument();
    expect(within(dragonCard).getByText("Marca GW")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skins" }));
    const skinCard = screen.getByRole("heading", { name: "Kitsune Galaxy" }).closest("article")!;
    expect(within(skinCard).getByText("Marca GW")).toBeInTheDocument();
  });

  it("abre o detalhe, respeita estoque e mantém carrinho de visitante com os valores atuais", async () => {
    const user = userEvent.setup();
    render(<Storefront catalog={CATALOG} buyerName={null} />);
    await user.click(screen.getByRole("button", { name: "Explorar Frutas físicas" }));
    await user.click(screen.getByRole("button", { name: "Ver Dragon West" }));
    const detail = screen.getByRole("dialog", { name: "Dragon West" });
    const quantity = within(detail).getByRole("spinbutton", { name: "Quantidade" });
    fireEvent.change(quantity, { target: { value: "9" } });
    expect(quantity).toHaveValue(3);
    await user.click(within(detail).getByRole("button", { name: "Adicionar ao carrinho" }));
    const cart = screen.getByRole("dialog", { name: "Seu carrinho" });
    expect(within(cart).getByRole("spinbutton", { name: "Quantidade de Dragon West" })).toHaveValue(3);
    expect(within(cart).getAllByText(/R\$\s*165,00/).length).toBeGreaterThan(0);
    expect(within(cart).getByRole("heading", { name: "Finalize com sua conta" })).toBeInTheDocument();
    expect(within(cart).getByText(/Google, Discord ou e-mail/)).toBeInTheDocument();
    const login = within(cart).getByRole("link", { name: "Entrar e finalizar" });
    const loginUrl = new URL(login.getAttribute("href")!, "https://gwstoreofc.com");
    expect(loginUrl.pathname).toBe("/entrar");
    const returnUrl = new URL(loginUrl.searchParams.get("next")!, "https://gwstoreofc.com");
    expect(returnUrl.pathname).toBe("/");
    expect(returnUrl.searchParams.get("checkout")).toBe("1");
    expect(JSON.parse(returnUrl.searchParams.get("cart")!)).toEqual([{ productId: DRAGON, quantity: 3 }]);
    expect(within(cart).queryByRole("button", { name: "Continuar para o pagamento" })).not.toBeInTheDocument();
    expect(within(cart).queryByRole("textbox", { name: "Seu usuário no Roblox" })).not.toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("gwstore.shop.cart.v1")!)).toEqual([{ productId: DRAGON, quantity: 3 }]));
    await user.click(within(cart).getByRole("button", { name: "Remover Dragon West" }));
    expect(within(cart).getByRole("heading", { name: "O carrinho está vazio" })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("restaura o carrinho do login sem aceitar preço da URL nem quantidade acima do estoque", async () => {
    const raw = JSON.stringify([{ productId: DRAGON, quantity: 999, priceCents: 1 }]);
    window.history.replaceState(null, "", `/?checkout=1&cart=${encodeURIComponent(raw)}`);
    await act(async () => { render(<Storefront catalog={CATALOG} buyerName="Ana" />); });
    const cart = await screen.findByRole("dialog", { name: "Seu carrinho" });
    expect(within(cart).getByRole("spinbutton", { name: "Quantidade de Dragon West" })).toHaveValue(3);
    expect(within(cart).getAllByText(/R\$\s*165,00/).length).toBeGreaterThan(0);
    expect(window.location.search).toBe("");
  });

  it("não permite adicionar item esgotado e explica falha de catálogo sem inventar produtos", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Storefront catalog={CATALOG} buyerName={null} />);
    await user.click(screen.getByRole("button", { name: "Explorar Frutas físicas" }));
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

  it("abre o pedido confirmado e limpa os dados de tentativa do carrinho", async () => {
    const user = userEvent.setup();
    const orderId = "60000000-0000-4000-8000-000000000006";
    localStorage.setItem("gwstore.shop.cart.v1", JSON.stringify([{ productId: DRAGON, quantity: 1 }]));
    request.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, orderId }), { status: 200 }));
    render(<CartCheckout open onClose={vi.fn()} cart={[{ productId: DRAGON, quantity: 1 }]}
      products={flattenShopCatalog(CATALOG)} signedIn onQuantity={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "Seu usuário no Roblox" }), "Buyer_123");
    await user.click(screen.getByRole("button", { name: "Continuar para o pagamento" }));
    await waitFor(() => expect(routing.push).toHaveBeenCalledWith(`/minhas-compras/${orderId}`));
    expect(localStorage.getItem("gwstore.shop.cart.v1")).toBeNull();
    expect(localStorage.getItem("gwstore.shop.checkout.v1")).toBeNull();
  });
});
