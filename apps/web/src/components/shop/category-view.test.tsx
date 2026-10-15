import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flattenShopCatalog, SHOP_CATEGORIES } from "@/lib/shop/catalog-view";
import type { ShopCatalogGame, ShopCatalogProduct } from "@/lib/shop/types";
import { CategoryView } from "./category-view";
import type { ShopCategory, ShopCategoryId } from "./shop-visuals";

vi.mock("@/components/layout/brand-mark", () => ({ BrandMark: () => <span aria-hidden="true">Marca GW</span> }));

let seq = 0;
const product = (name: string, priceCents: number, extras: Partial<ShopCatalogProduct> = {}): ShopCatalogProduct => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, name, description: "Entrega combinada no atendimento privado da compra.",
  priceCents, availableStock: 3, sortOrder: 1, isUpService: false, serviceRequirements: [], ...extras,
});
const service = (name: string, priceCents: number, requirement: string) =>
  product(name, priceCents, { isUpService: true, unlimitedStock: true, availableStock: 0, serviceRequirements: [requirement] });
const substore = (id: string, name: string, products: ShopCatalogProduct[]) =>
  ({ id, name, title: name, description: "", colorHex: "#ff00ff", imageUrl: null, products });
const catalog = (substores: ReturnType<typeof substore>[]): ShopCatalogGame[] =>
  [{ id: "game", name: "Blox Fruits", catalogStoreName: "Blox Fruits", substores }];

const FRUITS = substore("physical", "Frutas físicas", [
  product("Dragon West", 5_500, { imageUrl: "https://images.example/dragon.webp" }), product("Yeti", 500)]);
const PERMANENT = substore("permanent", "Permanentes", [product("Dough Permanente", 12_000)]);
const V4 = substore("v4", "UP · Raças V4", [service("Raça V4", 1_500, "Ter nível 2550")]);
const MASTERY = substore("mastery", "UP · Maestria", [service("Maestria 0–250", 500, "Informe a arma."), service("Maestria Full", 2_500, "Informe a arma.")]);
const SWORDS = substore("swords", "UP · Espadas", [service("CDK", 1_500, "Serviço completo. É necessário possuir Yama + Tushita.")]);

const categoryOf = (id: ShopCategoryId) => SHOP_CATEGORIES.find(item => item.id === id) as ShopCategory;

function renderView(id: ShopCategoryId, games: ShopCatalogGame[], overrides: Partial<Parameters<typeof CategoryView>[0]> = {}) {
  const products = flattenShopCatalog(games);
  const categories = SHOP_CATEGORIES.filter((item): item is ShopCategory =>
    item.id !== "all" && products.some(entry => entry.category === item.id));
  const categoryProducts = products.filter(entry => entry.category === id);
  const props = {
    category: categoryOf(id), categories, categoryProducts, visible: categoryProducts,
    counts: Object.fromEntries(categories.map(item => [item.id, products.filter(entry => entry.category === item.id).length])) as Record<ShopCategoryId, number>,
    search: "", query: "", sort: "default", onSort: vi.fn(), onClearSearch: vi.fn(), onNavigate: vi.fn(), onOpen: vi.fn(),
    headingRef: createRef<HTMLHeadingElement>(), ...overrides,
  };
  render(<CategoryView {...props} />);
  return props;
}

const scrollIntoView = vi.fn();
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  scrollIntoView.mockReset();
});
afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

describe("página de categoria", () => {
  it("agrupa os serviços de UP sem índice quando há menos de 3 grupos", () => {
    renderView("up", catalog([FRUITS, V4]));
    expect(screen.getByRole("heading", { level: 2, name: "Raças V4" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 3, name: "Raça V4" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Grupos de serviços" })).not.toBeInTheDocument();
    expect(screen.getByText(/R\$\s*15,00/)).toBeInTheDocument();
  });

  it("mostra o índice de grupos e leva ao grupo escolhido sem mudar o endereço", () => {
    renderView("up", catalog([V4, MASTERY, SWORDS]));
    const index = screen.getByRole("navigation", { name: "Grupos de serviços" });
    expect(within(index).getAllByRole("button").map(button => button.getAttribute("aria-label")))
      .toEqual(["Ir para Raças V4", "Ir para Maestria", "Ir para Espadas"]);
    fireEvent.click(within(index).getByRole("button", { name: "Ir para Espadas" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 2, name: "Espadas" })).toHaveFocus();
    expect(screen.getByText("É necessário possuir Yama + Tushita.")).toBeInTheDocument();
  });

  it("ordenado por preço vira uma lista única, sem títulos de grupo", () => {
    const products = flattenShopCatalog(catalog([V4, MASTERY, SWORDS])).sort((a, b) => a.priceCents - b.priceCents);
    renderView("up", catalog([V4, MASTERY, SWORDS]), { sort: "price-asc", visible: products });
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
    expect(screen.queryByRole("navigation", { name: "Grupos de serviços" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent))
      .toEqual(["Maestria 0–250", "Raça V4", "CDK", "Maestria Full"]);
    expect(screen.getAllByText("Maestria · Informe a arma.")).toHaveLength(2);
  });

  it("cada produto tem um único alvo e a arte sem imagem leva a marca uma vez", () => {
    renderView("physical", catalog([FRUITS, PERMANENT]));
    const [dragon, yeti] = screen.getAllByRole("article");
    for (const card of [dragon, yeti]) {
      expect(within(card).getAllByRole("button")).toHaveLength(1);
      expect(within(card).getAllByRole("heading", { level: 3 })).toHaveLength(1);
    }
    expect(within(dragon).getByRole("button", { name: "Ver Dragon West" })).toBeInTheDocument();
    expect(within(dragon).getByRole("img", { name: "Dragon West" })).toBeInTheDocument();
    expect(within(dragon).queryByText("Marca GW")).not.toBeInTheDocument();
    expect(within(yeti).getAllByText("Marca GW")).toHaveLength(1);
  });

  it("os chips têm o nome exato da categoria e a próxima categoria navega", () => {
    const props = renderView("physical", catalog([FRUITS, PERMANENT]));
    const chips = screen.getByRole("group", { name: "Categorias de produtos" });
    expect(within(chips).getByRole("button", { name: "Frutas físicas" })).toHaveAttribute("aria-pressed", "true");
    expect(within(chips).getByRole("button", { name: "Permanentes" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { name: "Permanentes" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Próxima categoria: Permanentes" }));
    expect(props.onNavigate).toHaveBeenCalledWith("permanent");
    expect(screen.getByRole("combobox", { name: "Ordenar produtos" })).toHaveValue("default");
  });

  it("o foco de teclado rola só a fileira até o chip sair de baixo da ordenação; o clique não rola", async () => {
    const user = userEvent.setup();
    const props = renderView("physical", catalog([FRUITS, PERMANENT, V4]));
    const chips = screen.getByRole("group", { name: "Categorias de produtos" });
    // jsdom has no layout: the 214px row of a 360px phone, whose last 6px sit under the sort select.
    let scrollLeft = 0;
    Object.defineProperty(chips, "scrollLeft", { configurable: true, get: () => scrollLeft, set: (value: number) => { scrollLeft = value; } });
    chips.getBoundingClientRect = () => new DOMRect(0, 0, 214, 50);
    within(chips).getAllByRole("button").forEach((chip, index) => {
      const [left, width] = [[16, 161], [185, 165], [358, 175]][index];
      chip.getBoundingClientRect = () => new DOMRect(left - scrollLeft, 5, width, 40);
    });
    await user.click(within(chips).getByRole("button", { name: "Permanentes" }));
    expect(props.onNavigate).toHaveBeenCalledWith("permanent");
    expect(scrollLeft).toBe(0);
    await user.tab();
    expect(within(chips).getByRole("button", { name: "Serviços de UP" })).toHaveFocus();
    expect(scrollLeft).toBe(342);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("durante a busca não sugere a próxima categoria", () => {
    const yeti = flattenShopCatalog(catalog([FRUITS])).filter(entry => entry.name === "Yeti");
    renderView("physical", catalog([FRUITS, PERMANENT]), { search: "Yeti", query: "yeti", visible: yeti });
    expect(screen.getByRole("status")).toHaveTextContent("1 produto encontrado para “Yeti”");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Próxima categoria/ })).not.toBeInTheDocument();
  });
});
