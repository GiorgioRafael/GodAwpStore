"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Search, ShoppingBag, UserRound, X } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { flattenShopCatalog, formatShopPrice, SHOP_CATEGORIES, type ShopProductView } from "@/lib/shop/catalog-view";
import { encodeShopCartHandoff, hydrateShopCart, setShopCartQuantity, type ShopCartLine } from "@/lib/shop/cart";
import type { ShopCatalogGame } from "@/lib/shop/types";
import { CartCheckout } from "./cart-checkout";
import { CATEGORY_COVERS, CategoryDirectory, type ShopCategory } from "./category-directory";
import { ProductDetail } from "./product-detail";
import { ProductImage } from "./product-image";
import styles from "./shop.module.css";

const CART_STORAGE = "gwstore.shop.cart.v1";
const normalizeSearch = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function Storefront({ catalog, buyerName, catalogUnavailable = false }: {
  catalog: ShopCatalogGame[]; buyerName: string | null; catalogUnavailable?: boolean;
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
  const categoryProductCount = products.filter(product => product.category === category).length;

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
    products.some(product => product.category === item.id && normalizeSearch(`${product.name} ${product.categoryLabel} ${product.gameName}`).includes(query)));
  const visible = useMemo(() => {
    const filtered = products.filter(product => product.category === category &&
      normalizeSearch(`${product.name} ${product.categoryLabel} ${product.gameName}`).includes(query));
    if (sort === "price-asc") filtered.sort((a, b) => a.priceCents - b.priceCents);
    if (sort === "price-desc") filtered.sort((a, b) => b.priceCents - a.priceCents);
    if (sort === "default") filtered.sort((a, b) => Number(Boolean(b.unlimitedStock || b.availableStock > 0)) - Number(Boolean(a.unlimitedStock || a.availableStock > 0)));
    return filtered;
  }, [products, query, category, sort]);

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

  return <div className={styles.shop}>
    <header className={styles.header}><div className={styles.headerInner}>
      <Link href="/" onNavigate={returnHome} className={styles.brand} aria-label="GWStore, início"><span className={styles.brandMark}><BrandMark priority /></span><span>GW<span>Store</span></span></Link>
      <label className={styles.search}><Search size={18} aria-hidden="true" /><input type="search" aria-label={activeCategory ? `Buscar em ${activeCategory.label}` : "Buscar categorias ou produtos"} placeholder={activeCategory ? `Buscar em ${activeCategory.label}...` : "Buscar uma categoria..."} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <nav className={styles.headerActions} aria-label="Sua conta e carrinho">
        <Link href={buyerName ? "/minhas-compras" : "/entrar"} className={styles.accountLink} aria-label={buyerName ? "Minhas compras" : "Entrar na sua conta"}><UserRound size={19} /><span>{buyerName ? "Minhas compras" : "Entrar"}</span></Link>
        <button type="button" className={styles.cartButton} onClick={() => setCartOpen(true)}><ShoppingBag size={21} /><span>Carrinho</span>{cart.length ? <span className={styles.cartCount}>{cart.reduce((sum, line) => sum + line.quantity, 0)}</span> : null}</button>
      </nav>
    </div></header>
    <main>
      {!activeCategory ? <section className={styles.hero} aria-labelledby="shop-title">
        <div className={styles.heroArt}><Image src="/brands/gwstore-shop-hero.webp" alt="" fill sizes="(max-width: 700px) 100vw, 100vw" priority /></div>
        <div className={styles.heroInner}><h1 id="shop-title">Seu próximo upgrade<br /><span>começa aqui.</span></h1><p>Frutas, skins e serviços de Blox Fruits em um só lugar.</p>
          <a href="#catalogo" className={styles.primaryButton}>Explorar categorias <ArrowRight size={20} /></a>
        </div>
      </section> : null}
      <section id="catalogo" className={styles.catalog} aria-label={activeCategory?.label ?? "Categorias"}>
        {activeCategory ? <>
          <button type="button" className={styles.backToCategories} onClick={() => navigateCategory(null)}><ArrowLeft size={17} aria-hidden="true" />Voltar às categorias</button>
          <div className={styles.categoryHeading}><div><h1 id="catalog-title" className={styles.categoryTitle} ref={catalogHeading} tabIndex={-1}>{activeCategory.label}</h1>
            <p className={styles.catalogIntro}>{CATEGORY_COVERS[activeCategory.id].description}</p></div>
            <span className={styles.productCount}>{categoryProductCount} {categoryProductCount === 1 ? "produto" : "produtos"}</span></div>
        </> : <><h2 id="catalog-title" ref={catalogHeading} tabIndex={-1}>Escolha seu próximo upgrade</h2><p className={styles.catalogIntro}>Entre em uma categoria para explorar os produtos.</p></>}
        {activeCategory ? <div className={styles.catalogToolbar}><div className={styles.categories} aria-label="Categorias de produtos">
          {categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} className={category === item.id ? styles.categoryActive : styles.categoryButton} onClick={() => navigateCategory(item.id)}>{item.label}</button>)}
        </div><label className={styles.sortLabel}><span className="sr-only">Ordenar produtos</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="default">Ordem da loja</option><option value="price-asc">Menor preço</option><option value="price-desc">Maior preço</option></select></label></div>
          : null}
        {query ? <p className={styles.searchResult} role="status">{activeCategory ? `${visible.length} ${visible.length === 1 ? "produto encontrado" : "produtos encontrados"}` : `${matchingCategories.length} ${matchingCategories.length === 1 ? "categoria encontrada" : "categorias encontradas"}`} para “{search}” <button type="button" onClick={() => setSearch("")} aria-label="Limpar busca"><X size={15} /></button></p> : null}
        {catalogUnavailable ? <div className={styles.emptyState}><h3>O catálogo não carregou</h3><p>Tente novamente em instantes.</p><button className={styles.secondaryButton} onClick={() => window.location.reload()}>Recarregar catálogo</button></div>
          : !(activeCategory ? visible.length : matchingCategories.length) ? <div className={styles.emptyState}><h3>{products.length ? activeCategory ? "Nenhum produto encontrado" : "Nenhuma categoria encontrada" : "Ainda não há produtos disponíveis"}</h3><p>{products.length ? activeCategory ? "Experimente outro nome dentro desta categoria." : "Experimente outro nome de categoria ou produto." : "Volte em breve para conferir o catálogo."}</p>{query ? <button type="button" className={styles.secondaryButton} onClick={() => setSearch("")}>Limpar busca</button> : null}</div>
          : !activeCategory ? <CategoryDirectory categories={matchingCategories} onSelect={navigateCategory} />
          : <div className={styles.productGrid}>{visible.map(product => <article key={product.id} className={styles.productCard}>
            <button type="button" className={styles.productImageButton} onClick={() => { setSelected(product); setNotice(""); }} aria-label={`Ver ${product.name}`}><ProductImage product={product} /></button>
            <div className={styles.productCardContent}><p className={styles.categoryLabel}>{product.categoryLabel}</p><h3><button onClick={() => { setSelected(product); setNotice(""); }}>{product.name}</button></h3>
              <div className={styles.productCardBottom}><strong>{formatShopPrice(product.priceCents)}</strong><button className={`${styles.productButton} ${!product.unlimitedStock && product.availableStock === 0 ? styles.unavailableButton : ""}`} onClick={() => { setSelected(product); setNotice(""); }}>{product.unlimitedStock || product.availableStock > 0 ? "Ver produto" : "Indisponível"}</button></div>
            </div></article>)}</div>}
      </section>
    </main>
    <footer className={styles.footer}><div className={styles.footerInner}><Link href="/" onNavigate={returnHome} className={styles.brand}><span className={styles.brandMark}><BrandMark /></span><span>GW<span>Store</span></span></Link><nav aria-label="Links da loja"><Link href="/minhas-compras">Minhas compras e atendimento</Link><Link href="/admin">Área administrativa</Link></nav></div></footer>
    {notice ? <div className={styles.notice} role="alert">{notice}<button className={styles.iconButton} aria-label="Dispensar aviso" onClick={() => setNotice("")}><X size={16} /></button></div> : null}
    <ProductDetail key={selected?.id || "closed"} product={selected} onClose={() => setSelected(null)} onAdd={addProduct} />
    <CartCheckout open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} products={products} signedIn={Boolean(buyerName)} onQuantity={(id, quantity) => setCart(current => setShopCartQuantity(current, id, quantity, products))} />
  </div>;
}
