import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import styles from "./shop.module.css";

export function ShopShell({ children, buyerName }: { children: ReactNode; buyerName: string }) {
  return <div className={styles.shop}><header className={styles.header}><div className={styles.headerInner}>
    <Link href="/" className={styles.brand} aria-label="GWStore, início"><span className={styles.brandMark}><BrandMark /></span><span>GW<span>Store</span></span></Link>
    <nav className={styles.headerActions} aria-label="Sua conta"><Link href="/minhas-compras" className={styles.accountLink}>Minhas compras</Link>
      <form action="/auth/logout?next=%2F" method="POST"><button type="submit" className={styles.iconButton} aria-label={`Sair da conta de ${buyerName}`}><LogOut size={18} /></button></form>
    </nav>
  </div></header><main className={styles.accountContainer}>{children}</main><footer className={styles.footer}><div className={styles.footerInner}><Link href="/" className={styles.accountLink}><ArrowLeft size={15} /> Voltar à loja</Link><span className={styles.smallNote}>GWStore · Atendimento pelo site</span></div></footer></div>;
}
