import Image from "next/image";
import type { RefObject } from "react";
import {
  ArrowDown, ArrowRight, ChevronDown, Diamond, MessagesSquare, PackageOpen, QrCode, SearchX, ShoppingBag, Sparkles, Spade, TriangleAlert, UserRound,
} from "lucide-react";
import { CategoryDirectory } from "./category-directory";
import { Emblem, EmptyState, Kicker, SearchStatus } from "./shop-ui";
import type { ShopCategory, ShopCategoryId } from "./shop-visuals";
import ui from "./shop.module.css";
import styles from "./home.module.css";

// Factual copy only: no counts, ratings or delivery promises.
const STEPS = [
  { icon: ShoppingBag, title: "Escolha seus itens", text: "Navegue pelas categorias e monte seu carrinho com até 5 produtos diferentes por pedido." },
  { icon: QrCode, title: "Pague com Pix", text: "Entre na sua conta e gere o Pix do pedido. Seu carrinho é mantido durante o login." },
  { icon: MessagesSquare, title: "Combine a entrega no chat", text: "Depois do pagamento, o chat privado da compra abre aqui no site para você falar com a equipe." },
];

export function StoreHero() {
  return <section id="inicio" className={styles.hero} aria-labelledby="shop-title">
    <div className={styles.heroBillboard}>
      <div className={styles.heroArt}><Image src="/brands/gwstore-shop-hero.webp" alt="" fill sizes="(max-width: 700px) 100vw, (max-width: 1316px) 92vw, 1220px" preload /></div>
      <div className={styles.heroFx} aria-hidden="true"><span className={styles.heroPattern} />
        <span className={styles.suits}><Spade className={styles.suitA} fill="currentColor" aria-hidden="true" />
          <Diamond className={styles.suitB} fill="currentColor" aria-hidden="true" /></span></div>
      <div className={styles.heroInner}>
        <Kicker icon={Sparkles} className={styles.heroKicker}>O seu jogo. Um novo nível.</Kicker>
        <h1 id="shop-title" tabIndex={-1}>Seu próximo<br /><span>upgrade</span><br />começa aqui.</h1>
        <p className={styles.heroLead}>Frutas, skins, gamepasses e Robux.<br />Tudo para a sua próxima conquista.</p>
        <span className={styles.heroSignature}><span aria-hidden="true" /> Blox Fruits & Roblox</span>
      </div>
      <span className={styles.heroEdition} aria-hidden="true">GW / PLAY. UPGRADE. REPEAT.</span>
    </div>
    <div className={styles.heroActions}>
      <a href="#catalogo" className={ui.primaryButton}><ShoppingBag size={18} aria-hidden="true" /> Explorar categorias <ArrowRight size={18} aria-hidden="true" /></a>
      <a href="#como-funciona" className={styles.heroGuide}>Primeira vez por aqui? <span>Veja como comprar <ArrowDown size={14} aria-hidden="true" /></span></a>
    </div>
    <ul className={styles.heroFacts}>
      <li><QrCode size={16} aria-hidden="true" />Pagamento via Pix</li>
      <li><MessagesSquare size={16} aria-hidden="true" />Chat privado com a equipe</li>
      <li><UserRound size={16} aria-hidden="true" />Acompanhe pela sua conta</li></ul>
    <a href="#catalogo" className={styles.scrollHint} aria-label="Ir às categorias"><ChevronDown size={22} aria-hidden="true" /></a>
  </section>;
}

export function HowItWorks() {
  return <section id="como-funciona" className={styles.howItWorks} aria-labelledby="how-title"><div className={ui.container}>
    <div className={styles.sectionHeading}><Kicker className={styles.headKicker}>Simples, do início ao fim</Kicker><h2 id="how-title" tabIndex={-1}>Do carrinho ao chat<br /><span>em 3 passos.</span></h2>
      <p>Você escolhe o upgrade. A gente ajuda no próximo passo.</p></div>
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
      <Kicker className={styles.headKicker}>Encontre seu próximo upgrade</Kicker>
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
