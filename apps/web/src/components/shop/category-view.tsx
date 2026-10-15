"use client";

import Image from "next/image";
import { useEffect, useRef, type RefObject } from "react";
import { ArrowDownUp, ArrowLeft, ArrowRight, ChevronDown, Info, SearchX } from "lucide-react";
import type { ShopProductView } from "@/lib/shop/catalog-view";
import { ProductCard } from "./product-card";
import { revealFocused, ServiceList } from "./service-list";
import { EmptyState, Kicker, SearchStatus } from "./shop-ui";
import { CATEGORY_COVERS, cssVars, type ShopCategory, type ShopCategoryId } from "./shop-visuals";
import ui from "./shop.module.css";
import styles from "./catalog.module.css";

export function CategoryView({ category, categories, counts, categoryProducts, visible, search, query, sort, onSort, onClearSearch, onNavigate, onOpen, headingRef }: {
  category: ShopCategory; categories: ShopCategory[]; counts: Record<ShopCategoryId, number>;
  /** Every product of this category, catalog order (unfiltered). */
  categoryProducts: ShopProductView[];
  /** Filtered and sorted by Storefront. */
  visible: ShopProductView[];
  search: string; query: string; sort: string; onSort: (value: string) => void; onClearSearch: () => void;
  onNavigate: (id: ShopCategoryId | null) => void; onOpen: (product: ShopProductView) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const chipsRef = useRef<HTMLDivElement>(null);
  const visual = CATEGORY_COVERS[category.id];
  const n = counts[category.id] ?? 0;
  const feature = categoryProducts.length === 1;
  const next = categories.length > 1 ? categories[(categories.findIndex(item => item.id === category.id) + 1) % categories.length] : null;
  const nextVisual = next ? CATEGORY_COVERS[next.id] : null;

  useEffect(() => {
    // Scroll the chip row (never the page, so no scrollIntoView) to the active chip.
    const row = chipsRef.current;
    const active = row?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (row && active) row.scrollLeft = active.offsetLeft - 16;
  }, [category.id]);

  return <>
    <div className={styles.categoryHero} style={cssVars({ "--hue": visual.hue, "--band-pos": visual.bandPos })}>
      <Image src={visual.image} alt="" fill sizes="(max-width: 1220px) 100vw, 1220px" loading="eager" fetchPriority="high" />
      <button type="button" className={styles.backToCategories} onClick={() => onNavigate(null)}><ArrowLeft size={17} aria-hidden="true" />Voltar às categorias</button>
      <div className={styles.categoryHeading}>
        <div><Kicker icon={visual.icon}>Categoria</Kicker>
          <h1 id="catalog-title" className={styles.categoryTitle} ref={headingRef} tabIndex={-1}>{category.label}</h1>
          <p className={styles.catalogIntro}>{visual.description}</p></div>
        <span className={styles.productCount}>{n} {category.id === "up" ? (n === 1 ? "serviço" : "serviços") : (n === 1 ? "produto" : "produtos")}</span>
      </div>
    </div>
    <div className={styles.catalogToolbar}>
      <div ref={chipsRef} className={styles.chips} role="group" aria-label="Categorias de produtos" onFocus={revealFocused}>
        {categories.map(item => {
          const itemVisual = CATEGORY_COVERS[item.id]; const active = item.id === category.id;
          return <button key={item.id} type="button" aria-label={item.label} aria-pressed={active} style={cssVars({ "--hue": itemVisual.hue })}
            className={active ? styles.chipActive : styles.chip} onClick={() => onNavigate(item.id)}>
            <itemVisual.icon size={16} aria-hidden="true" /><span>{item.label}</span><span className={styles.chipCount} aria-hidden="true">{counts[item.id]}</span></button>;
        })}
      </div>
      <label className={styles.sortLabel} data-sorted={sort === "default" ? undefined : ""}><span className="sr-only">Ordenar produtos</span>
        <ArrowDownUp size={16} aria-hidden="true" className={styles.sortIcon} />
        <select value={sort} onChange={event => onSort(event.target.value)}><option value="default">Ordem da loja</option><option value="price-asc">Menor preço</option><option value="price-desc">Maior preço</option></select>
        <ChevronDown size={16} aria-hidden="true" className={styles.sortChevron} /></label>
    </div>
    {query ? <SearchStatus message={`${visible.length} ${visible.length === 1 ? "produto encontrado" : "produtos encontrados"}`} search={search} onClear={onClearSearch} /> : null}
    {category.id === "up" && !query ? <p className={styles.serviceIntro} style={cssVars({ "--hue": visual.hue })}><Info size={18} aria-hidden="true" />
      No checkout, informe seu usuário do Roblox e confirme os requisitos do serviço. Depois do Pix, a execução é combinada com a equipe no chat da compra.</p> : null}
    {!visible.length ? <EmptyState icon={SearchX} title="Nenhum produto encontrado" text="Experimente outro nome dentro desta categoria."
        action={query ? <button type="button" className={ui.secondaryButton} onClick={onClearSearch}>Limpar busca</button> : null} />
      : category.id === "up" ? <ServiceList categoryProducts={categoryProducts} visible={visible} grouped={sort === "default"} showIndex={!query} onOpen={onOpen} />
      : <div className={styles.productGrid} data-layout={feature ? "feature" : undefined}>
        {visible.map((product, index) => <ProductCard key={product.id} product={product} index={index} feature={feature} onOpen={onOpen} />)}
      </div>}
    {!query && next && nextVisual ? <button type="button" className={styles.nextChapter} aria-label={`Próxima categoria: ${next.label}`}
      onClick={() => onNavigate(next.id)} style={cssVars({ "--hue": nextVisual.hue })}>
      <Image src={nextVisual.image} alt="" fill sizes="(max-width: 1220px) 100vw, 1220px" style={{ objectPosition: nextVisual.bandPos }} />
      <span className={styles.nextText}><span className={styles.nextKicker}>Próxima categoria</span><span className={styles.nextLabel}>{next.label}</span></span>
      <span className={styles.nextArrow} aria-hidden="true"><ArrowRight size={22} aria-hidden="true" /></span></button> : null}
  </>;
}
