import { ArrowRight } from "lucide-react";
import { formatShopPrice, type ShopProductView } from "@/lib/shop/catalog-view";
import { ProductImage } from "./product-image";
import { categoryVisual, cssVars } from "./shop-visuals";
import styles from "./catalog.module.css";

/** One tab stop: the image button's ::after stretches over the whole card. */
export function ProductCard({ product: p, index, feature = false, onOpen }: {
  product: ShopProductView; index: number; feature?: boolean; onOpen: (product: ShopProductView) => void;
}) {
  const available = Boolean(p.unlimitedStock || p.availableStock > 0);
  return <article className={feature ? `${styles.productCard} ${styles.featureCard}` : styles.productCard} data-available={available}
    style={cssVars({ "--hue": categoryVisual(p.category).hue, "--i": Math.min(index, 11) })}>
    <button type="button" className={styles.productOpen} aria-label={`Ver ${p.displayName}`} onClick={() => onOpen(p)}>
      <ProductImage product={p} variant="card" />{!available ? <span className={styles.soldBadge}>Indisponível</span> : null}</button>
    <div className={styles.productBody}>
      <h3>{p.displayName}</h3>
      {feature && p.description ? <p className={styles.featureDescription}>{p.description}</p> : null}
      <div className={styles.productBottom}>
        <strong className={styles.price}>{formatShopPrice(p.priceCents)}</strong>
        {available ? <span className={styles.cardGo} aria-hidden="true">
          {feature ? <>Ver detalhes <ArrowRight size={16} aria-hidden="true" /></> : <ArrowRight size={16} aria-hidden="true" />}</span>
          : <span className="sr-only">Indisponível</span>}
      </div>
    </div>
  </article>;
}
