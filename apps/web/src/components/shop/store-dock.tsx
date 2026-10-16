"use client";

import Link from "next/link";
import { BookOpen, Headphones, ReceiptText, ShoppingBag, UserRound } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import type { ShopInformation } from "@/lib/shop/information";
import styles from "./store-dock.module.css";

type StoreDockProps = {
  buyerName: string | null;
  cartCount: number;
  onHome: () => void;
  onCart: () => void;
  onHowItWorks?: () => void;
  information?: ShopInformation;
};

/** Persistent shortcuts; the host owns category and cart navigation state. */
export function StoreDock({ buyerName, cartCount, onHome, onCart, onHowItWorks, information }: StoreDockProps) {
  const AccountIcon = buyerName ? ReceiptText : UserRound;

  return <nav className={styles.dock} aria-label="Navegação rápida da loja">
    <Link href={buyerName ? "/minhas-compras" : "/entrar"} className={styles.action}
      aria-label={buyerName ? "Ver minhas compras" : "Sua conta"}>
      <span className={styles.icon}><AccountIcon size={22} strokeWidth={1.7} aria-hidden="true" /></span>
      <span className={styles.label}>{buyerName ? "Compras" : "Entrar"}</span>
    </Link>
    <a href="#como-funciona" className={styles.action} aria-label="Como comprar"
      onClick={onHowItWorks ? (event) => { event.preventDefault(); onHowItWorks(); } : undefined}>
      <span className={styles.icon}><BookOpen size={22} strokeWidth={1.7} aria-hidden="true" /></span>
      <span className={styles.label}>Como comprar</span>
    </a>
    <button type="button" className={`${styles.action} ${styles.home}`} onClick={onHome} aria-label="Ir para o início">
      <span className={styles.emblem} aria-hidden="true"><span className={styles.logo}><BrandMark className={styles.logoImage} /></span></span>
      <span className={styles.label}>Início</span>
    </button>
    <button type="button" className={styles.action} onClick={onCart}
      aria-label={`Ver carrinho, ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}>
      <span className={styles.icon}><ShoppingBag size={22} strokeWidth={1.7} aria-hidden="true" />
        {cartCount > 0 && <span className={styles.count} aria-hidden="true">{cartCount > 99 ? "99+" : cartCount}</span>}
      </span>
      <span className={styles.label}>Carrinho</span>
    </button>
    <Link href="/atendimento" className={styles.action} aria-label="Ajuda e atendimento"
      title={information?.hours ? `Atendimento: ${information.hours}` : undefined}>
      <span className={styles.icon}><Headphones size={22} strokeWidth={1.7} aria-hidden="true" /></span>
      <span className={styles.label}>Atendimento</span>
    </Link>
  </nav>;
}
