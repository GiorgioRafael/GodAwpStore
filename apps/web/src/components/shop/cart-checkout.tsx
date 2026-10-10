"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Minus, Plus, Trash2 } from "lucide-react";
import { formatShopPrice, type ShopProductView } from "@/lib/shop/catalog-view";
import { shopCheckoutLoginHref, shopCartSubtotalCents, type ShopCartLine } from "@/lib/shop/cart";
import type { ShopCheckoutResponse } from "@/lib/shop/types";
import { ProductImage } from "./product-image";
import { ShopDialog } from "./shop-dialog";
import styles from "./shop.module.css";

export function CartCheckout({ open, onClose, cart, products, signedIn, onQuantity }: {
  open: boolean; onClose: () => void; cart: ShopCartLine[]; products: ShopProductView[]; signedIn: boolean;
  onQuantity: (productId: string, quantity: number) => void;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const total = shopCartSubtotalCents(cart, products) ?? 0;
  const lines = cart.flatMap(line => {
    const product = products.find(item => item.id === line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const services = lines.filter(line => line.product.isUpService);
  const loginHref = shopCheckoutLoginHref(cart);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !lines.length) return;
    if (!signedIn) { window.location.assign(loginHref); return; }
    setBusy(true); setError(null);
    const body = { items: cart, gameNickname: nickname.trim(), serviceRequirementsConfirmed: services.length ? confirmed : undefined };
    const fingerprint = JSON.stringify(body);
    // Keep the same key after an ambiguous network/provider response. The server
    // binds it to this buyer and cart and returns the existing order on retry.
    if (pending.current?.fingerprint !== fingerprint) {
      let saved: { fingerprint?: string; requestId?: string } | null = null;
      try { saved = JSON.parse(localStorage.getItem("gwstore.shop.checkout.v1") || "null"); } catch { /* retry still works in memory */ }
      pending.current = { fingerprint, requestId: saved?.fingerprint === fingerprint && /^[0-9a-f-]{36}$/i.test(saved?.requestId || "") ? saved!.requestId! : crypto.randomUUID() };
      try { localStorage.setItem("gwstore.shop.checkout.v1", JSON.stringify(pending.current)); } catch { /* private browsing */ }
    }
    try {
      const response = await fetch("/api/loja/checkout", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestId: pending.current.requestId }) });
      const result: ShopCheckoutResponse = await response.json();
      if (!result.ok) {
        if (response.status === 401) { window.location.assign(loginHref); return; }
        setError(result.error.message); return;
      }
      try { localStorage.removeItem("gwstore.shop.cart.v1"); localStorage.removeItem("gwstore.shop.checkout.v1"); } catch { /* order is already saved on the server */ }
      router.push(`/minhas-compras/${encodeURIComponent(result.orderId)}`);
    } catch { setError("Não foi possível confirmar a resposta. Tente novamente para retomar o mesmo pedido."); }
    finally { setBusy(false); }
  }

  return <ShopDialog open={open} title="Seu carrinho" onClose={onClose}>
    {!lines.length ? <div className={styles.emptyState}><h3>O carrinho está vazio</h3><p>Escolha um produto para começar sua compra.</p><button className={styles.primaryButton} onClick={onClose}>Explorar produtos</button></div>
      : <form onSubmit={checkout}>
        <div className={styles.cartLines}>{lines.map(line => <div key={line.productId} className={styles.cartLine}>
          <ProductImage product={line.product} /><div className={styles.cartLineContent}><h3>{line.product.name}</h3>
            <p>{formatShopPrice(line.product.priceCents)} por unidade</p>
            <div className={styles.quantityControl}>
              <button type="button" aria-label={`Diminuir quantidade de ${line.product.name}`} disabled={busy} onClick={() => onQuantity(line.productId, line.quantity - 1)}><Minus size={14} /></button>
              <input aria-label={`Quantidade de ${line.product.name}`} type="number" min={1} max={line.product.unlimitedStock ? 10000 : line.product.availableStock} value={line.quantity} disabled={busy}
                onChange={event => onQuantity(line.productId, Math.max(1, Math.floor(Number(event.target.value) || 1)))} />
              <button type="button" aria-label={`Aumentar quantidade de ${line.product.name}`} disabled={busy || line.quantity >= (line.product.unlimitedStock ? 10000 : line.product.availableStock)} onClick={() => onQuantity(line.productId, line.quantity + 1)}><Plus size={14} /></button>
            </div>
          </div><div className={styles.cartLinePrice}><strong>{formatShopPrice(line.product.priceCents * line.quantity)}</strong>
            <button type="button" className={styles.iconButton} disabled={busy} aria-label={`Remover ${line.product.name}`} onClick={() => onQuantity(line.productId, 0)}><Trash2 size={16} /></button></div>
        </div>)}</div>
        <div className={styles.totalRow}><span>Total dos produtos</span><strong>{formatShopPrice(total)}</strong></div>
        <p className={styles.smallNote}>O valor final será confirmado no pedido.</p>
        {signedIn ? <>
          <label className={styles.field}>Seu usuário no Roblox<input required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" autoComplete="off" placeholder="Nome da conta que receberá o item" value={nickname} disabled={busy} onChange={event => setNickname(event.target.value)} /></label>
          <p className={styles.smallNote}>Informe o nome de usuário, não o nome de exibição.</p>
          {services.length ? <div className={styles.requirements}><h3>Requisitos dos serviços</h3>
            {services.map(line => <div key={line.productId}><strong>{line.product.name}</strong>{line.product.serviceRequirements.map((item, i) => <p key={i}>{item}</p>)}</div>)}
            <label className={styles.checkLabel}><input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Li os requisitos e minha conta atende ao necessário.</label>
          </div> : null}
        </> : <div className={styles.loginNote}><h3>Finalize com sua conta</h3><p>Entre com Google, Discord ou e-mail para pagar e acompanhar a entrega no chat do site. Seu carrinho será mantido.</p></div>}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {signedIn
          ? <button type="submit" className={styles.primaryButton} disabled={busy || total <= 0}>{busy ? <><LoaderCircle className={styles.spinner} size={18} /> Preparando pedido…</> : <>Continuar para o pagamento<ArrowRight size={18} /></>}</button>
          : total > 0 ? <a href={loginHref} className={styles.primaryButton}>Entrar e finalizar<ArrowRight size={18} /></a>
            : <button type="button" className={styles.primaryButton} disabled>Entrar e finalizar<ArrowRight size={18} /></button>}
        <p className={styles.checkoutNote}>Depois do pagamento, o chat desta compra fica disponível aqui no site para combinar a entrega.</p>
      </form>}
  </ShopDialog>;
}
