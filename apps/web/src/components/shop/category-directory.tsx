import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Emblem } from "./shop-ui";
import { CATEGORY_COVERS, cssVars, type ShopCategory, type ShopCategoryId } from "./shop-visuals";
import styles from "./home.module.css";

/** Home deck of category covers. Each cover is one button named `Explorar ${label}`; it shows no prices. */
export function CategoryDirectory({ categories, counts, matches, onSelect }: {
  categories: ShopCategory[];
  counts: Record<ShopCategoryId, number>;
  matches?: Partial<Record<ShopCategoryId, number>>;
  onSelect: (id: ShopCategoryId) => void;
}) {
  return <div className={styles.categoryGrid}>{categories.map((category, index) => {
    const visual = CATEGORY_COVERS[category.id];
    const total = counts[category.id] ?? 0;
    const found = matches?.[category.id];
    const countText = found ? `${found} ${found === 1 ? "resultado" : "resultados"}`
      : category.id === "up" ? `${total} ${total === 1 ? "serviço" : "serviços"}` : `${total} ${total === 1 ? "item" : "itens"}`;
    return <button type="button" key={category.id} className={styles.categoryCover} onClick={() => onSelect(category.id)}
      aria-label={`Explorar ${category.label}`} data-found={found ? "" : undefined} style={cssVars({ "--hue": visual.hue, "--pos": visual.pos, "--pos-sm": visual.posSm, "--i": index })}>
      <Image src={visual.image} alt="" fill sizes="(max-width: 1000px) 50vw, 400px" />
      <Emblem icon={visual.icon} size="s" className={styles.coverBadge} />
      <span className={styles.coverCount}>{countText}</span>
      <span className={styles.coverContent}>
        <span className={styles.coverText}><span className={styles.coverTitle}>{category.label}</span>
          <span className={styles.coverDescription}>{visual.description}</span></span>
        <span className={styles.coverArrow} aria-hidden="true"><ArrowRight size={20} aria-hidden="true" /></span>
      </span>
    </button>;
  })}</div>;
}
