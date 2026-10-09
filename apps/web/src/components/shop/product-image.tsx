"use client";

import { useState } from "react";
import { BrandMark } from "@/components/layout/brand-mark";
import type { ShopProductView } from "@/lib/shop/catalog-view";
import styles from "./shop.module.css";

export function ProductImage({ product }: { product: Pick<ShopProductView, "imageUrl" | "name" | "categoryLabel"> }) {
  const [failed, setFailed] = useState(false);
  return <div className={styles.productImage}>
    {product.imageUrl && !failed ? (
      // Catalog images are public assets managed in the existing panel. Loading
      // them directly supports its image hosts without proxying private URLs.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={product.imageUrl} alt={product.name} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    ) : <div className={styles.imageFallback}><span><BrandMark /></span><small>{product.categoryLabel}</small></div>}
  </div>;
}
