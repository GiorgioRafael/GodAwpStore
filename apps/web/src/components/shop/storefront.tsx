"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessagesSquare, QrCode, Search, ShoppingBag, TriangleAlert, UserRound, X } from "lucide-react";
import { flattenShopCatalog, formatShopPrice, SHOP_CATEGORIES, type ShopProductView } from "@/lib/shop/catalog-view";
import { encodeShopCartHandoff, hydrateShopCart, setShopCartQuantity, shopCartSubtotalCents, type ShopCartLine } from "@/lib/shop/cart";
import type { ShopCatalogGame } from "@/lib/shop/types";
import type { ShopInformation } from "@/lib/shop/information";
import { CartCheckout } from "./cart-checkout";
import { CategoryView } from "./category-view";
import { HomeCatalog, HowItWorks, StoreHero } from "./home-sections";
import { ProductDetail } from "./product-detail";
import { ShopBrandLink } from "./shop-ui";
import { BeforeBuying, ShopInformationLinks } from "./shop-information";
import { CATEGORY_COVERS, type ShopCategory, type ShopCategoryId } from "./shop-visuals";
import ui from "./shop.module.css";

const CART_STORAGE = "gwstore.shop.cart.v1";
const normalizeSearch = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
// Cleaned names and UP sub-groups ("maestria") are searchable too; filtering semantics are unchanged.
const productHaystack = (product: ShopProductView) =>
  `${product.name} ${product.displayName} ${product.categoryLabel} ${product.gameName}${product.category === "up" ? ` ${product.groupName}` : ""}`;

export function Storefront({ catalog, buyerName, catalogUnavailable = false, information }: {
  catalog: ShopCatalogGame[]; buyerName: string | null; catalogUnavailable?: boolean; information?: ShopInformation;
}) {
  const products = useMemo(() => flattenShopCatalog(catalog), [catalog]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ShopCategory["id"] | null>(null);
  const [sort, setSort] = useState("default");
  const [cart, setCart] = useState<ShopCartLine[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [selected, setSelected] = useState<ShopProductView | null>(null);
  const [notice, setNotice] = useState("");
  const catalogHeading = useRef<HTMLHeadingElement>(null);
  const categories = useMemo(() => SHOP_CATEGORIES.filter((item): item is ShopCategory =>
    item.id !== "all" && products.some(product => product.category === item.id)), [products]);
  const activeCategory = categories.find(item => item.id === category);
  const categoryProducts = useMemo(() => products.filter(product => product.category === category), [products, category]);
  const counts = useMemo(() => Object.fromEntries(categories.map(item =>
    [item.id, products.filter(product => product.category === item.id).length])) as Record<ShopCategoryId, number>, [categories, products]);

  useEffect(() => {
    function restoreCategory() {
      const id = new URL(window.location.href).searchParams.get("categoria");
      setCategory(categories.find(item => item.id === id)?.id ?? null);
      setSearch(""); setSort("default"); setSelected(null);
    }
    // Keep category links shareable and support the browser's back/forward buttons.
    Promise.resolve().then(restoreCategory);
    window.addEventListener("popstate", restoreCategory);
    return () => window.removeEventListener("popstate", restoreCategory);
  }, [categories]);

  useEffect(() => {
    let active = true;
    // Only public product IDs/quantities travel through the OAuth next URL, so
    // the cart can survive the temporary login-domain bridge. Revalidate them
    // against the latest catalog rather than restoring prices from the URL.
    Promise.resolve().then(() => {
      if (!active) return;
      const url = new URL(window.location.href);
      let saved: unknown = url.searchParams.get("cart");
      try { saved ??= localStorage.getItem(CART_STORAGE); } catch { /* private browsing */ }
      setCart(hydrateShopCart(saved, products)); setCartReady(true);
      if (url.searchParams.get("checkout") === "1") setCartOpen(true);
      if (url.searchParams.has("cart") || url.searchParams.has("checkout")) {
        url.searchParams.delete("cart"); url.searchParams.delete("checkout");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    });
    return () => { active = false; };
  }, [products]);

  useEffect(() => {
    if (!cartReady) return;
    try { localStorage.setItem(CART_STORAGE, encodeShopCartHandoff(cart)); } catch { /* cart still works in memory */ }
  }, [cart, cartReady]);

  const query = normalizeSearch(search);
  const matchingCategories = categories.filter(item => !query ||
    normalizeSearch(`${item.label} ${CATEGORY_COVERS[item.id].description}`).includes(query) ||
    products.some(product => product.category === item.id && normalizeSearch(productHaystack(product)).includes(query)));
  const matches = query ? Object.fromEntries(matchingCategories.map(item => [item.id,
    products.filter(product => product.category === item.id && normalizeSearch(productHaystack(product)).includes(query)).length])) as Partial<Record<ShopCategoryId, number>> : undefined;
  const visible = useMemo(() => {
    const filtered = products.filter(product => product.category === category &&
      normalizeSearch(productHaystack(product)).includes(query));
    if (sort === "price-asc") filtered.sort((a, b) => a.priceCents - b.priceCents);
    if (sort === "price-desc") filtered.sort((a, b) => b.priceCents - a.priceCents);
    if (sort === "default") filtered.sort((a, b) => Number(Boolean(b.unlimitedStock || b.availableStock > 0)) - Number(Boolean(a.unlimitedStock || a.availableStock > 0)));
    return filtered;
  }, [products, query, category, sort]);
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = shopCartSubtotalCents(cart, products);

  function returnHome() {
    setCategory(null); setSearch(""); setSort("default"); setSelected(null);
  }

  function navigateCategory(id: ShopCategory["id"] | null) {
    setCategory(id); setSearch(""); setSort("default"); setSelected(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("categoria", id); else url.searchParams.delete("categoria");
    url.hash = "";
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    requestAnimationFrame(() => {
      catalogHeading.current?.focus({ preventScroll: true });
      document.getElementById("catalogo")?.scrollIntoView({ block: "start" });
    });
  }

  function addProduct(product: ShopProductView, quantity: number) {
    if (cart.length >= 5 && !cart.some(item => item.productId === product.id)) {
      setNotice("Você pode escolher até 5 produtos diferentes por pedido."); return;
    }
    const previous = cart.find(item => item.productId === product.id)?.quantity || 0;
    setCart(current => setShopCartQuantity(current, product.id, previous + quantity, products));
    setSelected(null); setCartOpen(true); setNotice("");
  }

  const openProduct = (product: ShopProductView) => { setSelected(product); setNotice(""); };

  return <div className={ui.shop}>
    <header className={ui.header}><div className={ui.headerInner}>
      <ShopBrandLink label="GWStore, início" onNavigate={returnHome} priority />
      <label className={ui.search}><Search size={18} aria-hidden="true" />
        <input type="search" enterKeyHint="search" aria-label={activeCategory ? `Buscar em ${activeCategory.label}` : "Buscar categorias ou produtos"}
          placeholder={activeCategory ? `Buscar em ${activeCategory.label}…` : "Buscar frutas, skins, serviços…"} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <nav className={ui.headerActions} aria-label="Sua conta e carrinho">
        <Link href={buyerName ? "/minhas-compras" : "/entrar"} className={ui.accountLink} aria-label={buyerName ? "Minhas compras" : "Entrar na sua conta"}>
          {buyerName ? <span className={ui.avatar} aria-hidden="true">{(buyerName.trim().charAt(0) || "?").toUpperCase()}</span> : <UserRound size={19} aria-hidden="true" />}
          <span className={ui.accountText}>{buyerName ? "Minhas compras" : "Entrar"}</span></Link>
        {/* On phones a non-empty cart floats as a pill; the subtotal is drawn from data-subtotal by CSS (no extra price text node). */}
        <button type="button" className={ui.cartButton} data-count={cartCount}
          data-subtotal={cartCount && subtotal != null ? formatShopPrice(subtotal) : undefined}
          aria-label={cartCount ? `Abrir carrinho, ${cartCount} ${cartCount === 1 ? "item" : "itens"}${subtotal != null ? `, total ${formatShopPrice(subtotal)}` : ""}` : "Abrir carrinho"}
          onClick={() => setCartOpen(true)}>
          <ShoppingBag size={20} aria-hidden="true" /><span className={ui.cartLabel}>Carrinho</span>
          {cartCount ? <span key={cartCount} className={ui.cartCount} aria-hidden="true">{cartCount}</span> : null}</button>
      </nav>
    </div></header>
    <main>
      {/* While searching, the results replace the hero so they show without scrolling. */}
      {!activeCategory && !query ? <StoreHero /> : null}
      <section id="catalogo" className={ui.catalog} data-view={activeCategory ? "category" : "home"} aria-label={activeCategory?.label ?? "Categorias"}>
        {activeCategory
          ? <CategoryView category={activeCategory} categories={categories} counts={counts} categoryProducts={categoryProducts} visible={visible}
              search={search} query={query} sort={sort} onSort={setSort} onClearSearch={() => setSearch("")}
              onNavigate={navigateCategory} onOpen={openProduct} headingRef={catalogHeading} />
          : <HomeCatalog categories={matchingCategories} counts={counts} matches={matches} search={search} query={query}
              onClearSearch={() => setSearch("")} onSelect={navigateCategory} headingRef={catalogHeading}
              catalogUnavailable={catalogUnavailable} hasProducts={products.length > 0} />}
      </section>
      {!activeCategory && !query ? <HowItWorks /> : null}
      {!activeCategory && !query ? <BeforeBuying information={information} /> : null}
    </main>
    <footer className={ui.footer}><div className={ui.footerInner}>
      <div className={ui.footerBrand}><ShopBrandLink onNavigate={returnHome} /><p>Frutas, skins, gamepasses e serviços de UP de Blox Fruits, além de Robux.</p></div>
      <nav className={ui.footerNav} aria-label="Links da loja"><Link href="/minhas-compras">Minhas compras e atendimento</Link><ShopInformationLinks /><Link href="/admin">Área administrativa</Link></nav>
      <ul className={ui.footerFacts}><li><QrCode size={15} aria-hidden="true" />Pagamento via Pix</li><li><MessagesSquare size={15} aria-hidden="true" />Atendimento pelo chat do site</li></ul>
    </div></footer>
    {/* The page is inert behind an open product detail, so the page-level notice renders only without one. */}
    {notice && !selected ? <div className={ui.notice} role="alert"><TriangleAlert size={18} aria-hidden="true" /><span>{notice}</span>
      <button type="button" className={ui.iconButton} aria-label="Dispensar aviso" onClick={() => setNotice("")}><X size={16} aria-hidden="true" /></button></div> : null}
    <ProductDetail key={selected?.id || "closed"} product={selected} information={information} notice={notice} onDismissNotice={() => setNotice("")} onClose={() => setSelected(null)} onAdd={addProduct} />
    <CartCheckout open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} products={products} information={information} signedIn={Boolean(buyerName)} onQuantity={(id, quantity) => setCart(current => setShopCartQuantity(current, id, quantity, products))} />
  </div>;
}
