import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { SHOP_CATEGORIES } from "@/lib/shop/catalog-view";
import styles from "./shop.module.css";

export type ShopCategory = Exclude<(typeof SHOP_CATEGORIES)[number], { id: "all" }>;

export const CATEGORY_COVERS: Record<ShopCategory["id"], { image: string; description: string }> = {
  physical: { image: "/brands/categories/physical.webp", description: "Para equipar, trocar e evoluir." },
  permanent: { image: "/brands/categories/permanent.webp", description: "Seu poder, sempre disponível." },
  gamepass: { image: "/brands/categories/gamepass.webp", description: "Vantagens para ir além." },
  skin: { image: "/brands/categories/skin.webp", description: "Um novo visual para seu jogo." },
  up: { image: "/brands/categories/up.webp", description: "O próximo nível começa aqui." },
  other: { image: "/brands/categories/other.webp", description: "Mais possibilidades para sua jornada." },
};

export function CategoryDirectory({ categories, onSelect }: {
  categories: ShopCategory[];
  onSelect: (id: ShopCategory["id"]) => void;
}) {
  return <div className={styles.categoryGrid}>
    {categories.map(category => <button type="button" key={category.id} className={styles.categoryCover}
      onClick={() => onSelect(category.id)} aria-label={`Explorar ${category.label}`}>
      <Image src={CATEGORY_COVERS[category.id].image} alt="" fill
        sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 1000px) 50vw, 400px" />
      <span className={styles.categoryCoverContent}>
        <span className={styles.categoryCoverText}><span className={styles.categoryCoverTitle}>{category.label}</span>
          <span className={styles.categoryCoverDescription}>{CATEGORY_COVERS[category.id].description}</span></span>
        <span className={styles.categoryCoverArrow}><ArrowRight size={20} aria-hidden="true" /></span>
      </span>
    </button>)}
  </div>;
}
