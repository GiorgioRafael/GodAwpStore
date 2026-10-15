"use client";

import { MessagesSquare, Minus, Plus, QrCode, ShieldAlert, ShoppingBag, TriangleAlert, X } from "lucide-react";
import { createElement, useId, useState } from "react";
import { formatShopPrice, shopProductDescription, type ShopProductView } from "@/lib/shop/catalog-view";
import { ShopDialog } from "./shop-dialog";
import { ProductImage } from "./product-image";
import { categoryVisual, cssVars, productIcon } from "./shop-visuals";
import ui from "./shop.module.css";
import styles from "./dialogs.module.css";

/** "Item inspect": showcase art beside price, stock, requirements and the add-to-cart bar (a pinned bar on phones). */
export function ProductDetail({ product, onClose, onAdd, notice, onDismissNotice }: {
  product: ShopProductView | null; onClose: () => void; onAdd: (product: ShopProductView, quantity: number) => void;
  notice?: string; onDismissNotice?: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const qtyId = useId();
  const available = product && (product.unlimitedStock || product.availableStock > 0);
  const max = product?.unlimitedStock ? 10000 : Math.min(10000, product?.availableStock || 1);
  const description = product ? shopProductDescription(product)
    ?? (product.isUpService ? null : "Após o pagamento, combine a entrega com a equipe no chat privado da sua compra.") : null;
  return <ShopDialog open={Boolean(product)} title={product?.displayName || "Produto"} onClose={onClose} wide>
    {product ? <div className={styles.detailGrid} style={cssVars({ "--hue": categoryVisual(product.category).hue })}>
      <div className={styles.detailShowcase}><ProductImage product={product} variant="showcase" />
        {/* createElement: the icon is looked up, not created, during render (react-hooks/static-components). */}
        <span className={styles.showcaseChip}>{createElement(productIcon(product), { size: 14, "aria-hidden": true })}{product.category === "up" ? product.groupName : product.categoryLabel}</span></div>
      <div className={styles.detailContent}>
        <p className={styles.detailKicker}>{product.category === "up" ? `${product.categoryLabel} · ${product.groupName}` : `${product.categoryLabel} · ${product.gameName}`}</p>
        <strong className={styles.detailPrice}>{formatShopPrice(product.priceCents)}</strong>
        <p className={styles.stock} data-state={!available ? "out" : product.unlimitedStock ? "open" : "limited"}>{available ? product.unlimitedStock ? "Disponível para comprar" : `${product.availableStock} ${product.availableStock === 1 ? "unidade disponível" : "unidades disponíveis"}` : "Indisponível no momento"}</p>
        {description ? <p className={styles.description}>{description}</p> : null}
        {product.isUpService ? <div className={styles.requirements}><h3><ShieldAlert size={16} aria-hidden="true" />Antes de contratar</h3>
          {product.serviceRequirements.map((requirement, i) => <p key={i}>{requirement}</p>)}</div> : null}
        <div className={styles.detailActions} data-available={available ? "true" : "false"}>
          {/* The page is inert behind the sheet, so the storefront notice shows here, inside the (sticky) bar. */}
          {notice ? <div className={`${ui.notice} ${styles.detailNotice}`} role="alert"><TriangleAlert size={18} aria-hidden="true" /><span>{notice}</span>
            <button type="button" className={ui.iconButton} aria-label="Dispensar aviso" onClick={onDismissNotice}><X size={16} aria-hidden="true" /></button></div> : null}
          <div className={styles.qtyField}><label htmlFor={qtyId}>Quantidade</label>
            <div className={styles.quantityControl}>
              <button type="button" aria-label="Diminuir quantidade" disabled={!available || quantity <= 1} onClick={() => setQuantity(q => Math.max(1, q - 1))}><Minus size={16} aria-hidden="true" /></button>
              <input id={qtyId} type="number" inputMode="numeric" min={1} max={max} step={1} value={quantity}
                onChange={event => setQuantity(Math.max(1, Math.min(max, Math.floor(Number(event.target.value) || 1))))} />
              <button type="button" aria-label="Aumentar quantidade" disabled={!available || quantity >= max} onClick={() => setQuantity(q => Math.min(max, q + 1))}><Plus size={16} aria-hidden="true" /></button>
            </div></div>
          <button type="button" className={`${ui.primaryButton} ${styles.addButton}`} disabled={!available} onClick={() => { onAdd(product, quantity); setQuantity(1); }}><Plus size={18} aria-hidden="true" /> Adicionar ao carrinho</button>
          {quantity > 1 ? <p className={styles.subtotal}>Subtotal: {formatShopPrice(product.priceCents * quantity)}</p> : null}
        </div>
        <ul className={styles.perks}><li><QrCode size={16} aria-hidden="true" />Pagamento via Pix</li>
          <li><MessagesSquare size={16} aria-hidden="true" />Entrega combinada no chat privado da compra</li>
          <li><ShoppingBag size={16} aria-hidden="true" />Até 5 produtos diferentes por pedido</li></ul>
      </div></div> : null}
  </ShopDialog>;
}
