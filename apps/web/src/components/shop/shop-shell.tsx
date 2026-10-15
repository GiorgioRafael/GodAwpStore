import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, LogOut, ReceiptText, Store } from "lucide-react";
import { ShopBrandLink } from "./shop-ui";
import { ShopInformationLinks } from "./shop-information";
import ui from "./shop.module.css";
import styles from "./account.module.css";

/** Signed-in account chrome (orders list and order page): store header, centred main column, slim footer. */
export function ShopShell({ children, buyerName }: { children: ReactNode; buyerName: string }) {
  return <div className={`${ui.shop} ${styles.shell}`}><header className={ui.header}><div className={ui.headerInner}>
    <ShopBrandLink label="GWStore, início" />
    <nav className={ui.headerActions} aria-label="Sua conta">
      <Link href="/" className={ui.accountLink}><Store size={18} aria-hidden="true" /><span className={ui.accountText}>Loja</span></Link>
      <Link href="/minhas-compras" className={ui.accountLink}><ReceiptText size={18} aria-hidden="true" /><span className={ui.accountText}>Minhas compras</span></Link>
      <form action="/auth/logout?next=%2F" method="POST"><button type="submit" className={ui.iconButton} title="Sair" aria-label={`Sair da conta de ${buyerName}`}><LogOut size={18} aria-hidden="true" /></button></form>
    </nav></div></header>
    <main className={`${ui.container} ${styles.accountContainer}`}>{children}</main>
    <footer className={ui.footer}><div className={`${ui.footerInner} ${ui.footerSlim}`}>
      <Link href="/" className={ui.accountLink}><ArrowLeft size={15} aria-hidden="true" /> Voltar à loja</Link><nav className={ui.footerNav} aria-label="Informações da loja"><ShopInformationLinks /></nav></div></footer>
  </div>;
}
