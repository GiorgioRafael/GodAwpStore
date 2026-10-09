"use client";

import { Plus, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { formatShopPrice, type ShopProductView } from "@/lib/shop/catalog-view";
import { ShopDialog } from "./shop-dialog";
import { ProductImage } from "./product-image";
import styles from "./shop.module.css";

export function ProductDetail({ product, onClose, onAdd }: {
  product: ShopProductView | null; onClose: () => void; onAdd: (product: ShopProductView, quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const available = product && (product.unlimitedStock || product.availableStock > 0);
  const max = product?.unlimitedStock ? 10000 : Math.min(10000, product?.availableStock || 1);
  return <ShopDialog open={Boolean(product)} title={product?.name || "Produto"} onClose={onClose} wide>
    {product ? <div className={styles.detailGrid}><ProductImage product={product} /><div className={styles.detailContent}>
      <p className={styles.categoryLabel}>{product.categoryLabel} · {product.gameName}</p>
      <strong className={styles.detailPrice}>{formatShopPrice(product.priceCents)}</strong>
      <p className={styles.description}>{product.description || "Após o pagamento, combine a entrega com a equipe no chat privado da sua compra."}</p>
      {product.isUpService ? <div className={styles.requirements}><h3>Antes de contratar</h3>
        {product.serviceRequirements.map((requirement, i) => <p key={i}>{requirement}</p>)}
      </div> : null}
      <p className={styles.stock}>{available ? product.unlimitedStock ? "Disponível para comprar" : `${product.availableStock} ${product.availableStock === 1 ? "unidade disponível" : "unidades disponíveis"}` : "Indisponível no momento"}</p>
      <label className={styles.field}>Quantidade<input type="number" min={1} max={max} step={1} value={quantity}
        onChange={event => setQuantity(Math.max(1, Math.min(max, Math.floor(Number(event.target.value) || 1))))} /></label>
      <button className={styles.primaryButton} disabled={!available} onClick={() => { onAdd(product, quantity); setQuantity(1); }}><Plus size={18} /> Adicionar ao carrinho</button>
      <p className={styles.smallNote}><ShoppingBag size={15} /> Pagamento e atendimento pelo site.</p>
    </div></div> : null}
  </ShopDialog>;
}
