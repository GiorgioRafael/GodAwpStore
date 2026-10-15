"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { shopPlaceholderWord, type ShopProductView } from "@/lib/shop/catalog-view";
import { categoryVisual, cssVars, productIcon } from "./shop-visuals";
import styles from "./catalog.module.css";

const ICON_SIZE = { card: 24, showcase: 38, thumb: 18, tile: 18 } as const;

// The icon arrives as a prop, so it is never a component created during render.
function ArtIcon({ icon: Icon, size }: { icon: LucideIcon; size: number }) {
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/** Product stage. Image-less (or broken) products get generated card art instead of the logo. */
export function ProductImage({ product, variant = "card" }: {
  product: Pick<ShopProductView, "imageUrl" | "name" | "displayName" | "category" | "categoryLabel" | "groupName">;
  variant?: "card" | "showcase" | "thumb" | "tile";
}) {
  const [failed, setFailed] = useState(false);
  const visual = categoryVisual(product.category);
  const word = shopPlaceholderWord(product);
  return <div className={styles.productImage} data-variant={variant} style={cssVars({ "--hue": visual.hue })}>
    {product.imageUrl && !failed ? (
      // Catalog images are public assets managed in the existing panel. Loading
      // them directly supports its image hosts without proxying private URLs.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={product.imageUrl} alt={product.displayName} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    ) : <div className={styles.imageFallback} data-size={word.length <= 7 ? "lg" : word.length <= 12 ? "md" : "sm"} aria-hidden="true">
      <span className={styles.fallbackEmblem}><ArtIcon icon={productIcon(product)} size={ICON_SIZE[variant]} /></span>
      {variant === "card" || variant === "showcase" ? <>
        <span className={styles.fallbackWord}>{word}</span>
        {/* UP art already sets the sub-group as the word, so the kicker names the category. */}
        <span className={styles.fallbackKicker}>{visual.singular}</span>
        <span className={styles.fallbackSeal}><BrandMark /></span>
      </> : null}
    </div>}
  </div>;
}
