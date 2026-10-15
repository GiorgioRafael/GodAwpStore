import Image from "next/image";
import type { RefObject } from "react";
import {
  ArrowDown, ArrowRight, Diamond, MessagesSquare, PackageOpen, QrCode, SearchX, ShoppingBag, Spade, TriangleAlert, UserRound,
} from "lucide-react";
import { CategoryDirectory } from "./category-directory";
import { Emblem, EmptyState, Kicker, SearchStatus } from "./shop-ui";
import type { ShopCategory, ShopCategoryId } from "./shop-visuals";
import ui from "./shop.module.css";
import styles from "./home.module.css";

// Factual copy only: no counts, ratings or delivery promises.
const STEPS = [
  { icon: ShoppingBag, title: "Escolha seus itens", text: "Navegue pelas categorias e monte seu carrinho com até 5 produtos diferentes por pedido." },
  { icon: QrCode, title: "Pague com Pix", text: "Entre com Google, Discord ou e-mail e gere o Pix do pedido. Seu carrinho é mantido durante o login." },
  { icon: MessagesSquare, title: "Combine a entrega no chat", text: "Depois do pagamento, o chat privado da compra abre aqui no site para você falar com a equipe." },
];

export function StoreHero() {
  return <section className={styles.hero} aria-labelledby="shop-title">
    {/* The image and the h1 are never animated: the art is the LCP element. */}
    <div className={styles.heroArt}><Image src="/brands/gwstore-shop-hero.webp" alt="" fill sizes="100vw" preload /></div>
    <div className={styles.heroFx} aria-hidden="true"><span className={styles.heroPattern} /><span className={styles.heroGlow} />
      <span className={styles.suits}><Spade className={styles.suitA} fill="currentColor" aria-hidden="true" />
        <Diamond className={styles.suitB} fill="currentColor" aria-hidden="true" /></span></div>
    <div className={`${ui.container} ${styles.heroInner}`}>
      <Kicker className={styles.heroKicker}>Blox Fruits · Robux</Kicker>
      <h1 id="shop-title">Seu próximo upgrade<br /><span>começa aqui.</span></h1>
      <p className={styles.heroLead}>Frutas, skins, gamepasses, serviços de UP e Robux. Pague com Pix e combine a entrega no chat privado da sua compra.</p>
      <div className={styles.heroActions}>
        <a href="#catalogo" className={ui.primaryButton}>Explorar categorias <ArrowRight size={20} aria-hidden="true" /></a>
        <a href="#como-funciona" className={`${ui.ghostButton} ${styles.heroGhost}`}>Como funciona <ArrowDown size={18} aria-hidden="true" /></a></div>
      <ul className={styles.heroFacts}>
        <li><QrCode size={16} aria-hidden="true" />Pagamento via Pix</li>
        <li><MessagesSquare size={16} aria-hidden="true" />Chat privado com a equipe</li>
        <li><UserRound size={16} aria-hidden="true" />Entre com Google, Discord ou e-mail</li></ul>
    </div>
  </section>;
}

export function HowItWorks() {
  return <section id="como-funciona" className={styles.howItWorks} aria-labelledby="how-title"><div className={ui.container}>
    <Kicker className={styles.headKicker}>Como funciona</Kicker><h2 id="how-title">Do carrinho ao chat em 3 passos</h2>
    <ol className={styles.steps}>{STEPS.map((step, index) => <li key={step.title} className={styles.step}>
      <span className={styles.stepNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <Emblem icon={step.icon} size="m" className={styles.stepEmblem} /><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol>
  </div></section>;
}

export function HomeCatalog({ categories, counts, matches, search, query, onClearSearch, onSelect, headingRef, catalogUnavailable, hasProducts }: {
  categories: ShopCategory[];
  counts: Record<ShopCategoryId, number>;
  matches?: Partial<Record<ShopCategoryId, number>>;
  search: string; query: string; onClearSearch: () => void;
  onSelect: (id: ShopCategoryId) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  catalogUnavailable: boolean; hasProducts: boolean;
}) {
  return <>
    <div className={styles.catalogHead}>
      <Kicker className={styles.headKicker}>Catálogo</Kicker>
      <h2 id="catalog-title" className={styles.catalogTitle} ref={headingRef} tabIndex={-1}>Escolha sua categoria</h2>
      {categories.length > 0 && !catalogUnavailable ?<p className={styles.catalogIntro}>Toque em uma categoria para ver os produtos e preços.</p> : null}
    </div>
    {query ? <SearchStatus message={`${categories.length} ${categories.length === 1 ? "categoria encontrada" : "categorias encontradas"}`} search={search} onClear={onClearSearch} /> : null}
    {catalogUnavailable ? <EmptyState icon={TriangleAlert} tone="danger" title="O catálogo não carregou" text="Tente novamente em instantes."
        action={<button type="button" className={ui.secondaryButton} onClick={() => window.location.reload()}>Recarregar catálogo</button>} />
      : !categories.length ? <EmptyState icon={hasProducts ? SearchX : PackageOpen}
          title={hasProducts ? "Nenhuma categoria encontrada" : "Ainda não há produtos disponíveis"}
          text={hasProducts ? "Experimente outro nome de categoria ou produto." : "Volte em breve para conferir o catálogo."}
          action={query ? <button type="button" className={ui.secondaryButton} onClick={onClearSearch}>Limpar busca</button> : null} />
      : <CategoryDirectory categories={categories} counts={counts} matches={matches} onSelect={onSelect} />}
  </>;
}
