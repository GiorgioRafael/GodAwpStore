"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Info, LoaderCircle, Minus, Plus, ShieldAlert, ShoppingBag, Trash2, UserRound } from "lucide-react";
import { formatShopPrice, type ShopProductView } from "@/lib/shop/catalog-view";
import { shopCheckoutLoginHref, shopCartSubtotalCents, type ShopCartLine } from "@/lib/shop/cart";
import type { ShopCheckoutResponse } from "@/lib/shop/types";
import { ProductImage } from "./product-image";
import { ShopDialog } from "./shop-dialog";
import { Emblem, EmptyState } from "./shop-ui";
import { categoryVisual, cssVars } from "./shop-visuals";
import ui from "./shop.module.css";
import styles from "./dialogs.module.css";

export function CartCheckout({ open, onClose, cart, products, signedIn, onQuantity }: {
  open: boolean; onClose: () => void; cart: ShopCartLine[]; products: ShopProductView[]; signedIn: boolean;
  onQuantity: (productId: string, quantity: number) => void;
}) {
  const router = useRouter();
  const hintId = useId();
  const errorId = useId();
  const [nickname, setNickname] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  // Disabling the busy button drops focus to <body>: hand it back (it lives in the sticky footer, so no scroll).
  useEffect(() => { if (error) submitRef.current?.focus({ preventScroll: true }); }, [error]);
  const total = shopCartSubtotalCents(cart, products) ?? 0;
  const lines = cart.flatMap(line => {
    const product = products.find(item => item.id === line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const services = lines.filter(line => line.product.isUpService);
  const loginHref = shopCheckoutLoginHref(cart);
  const cta = `${ui.primaryButton} ${styles.cta}`;

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

  return <ShopDialog open={open} title="Seu carrinho" onClose={onClose} variant="drawer"
    meta={lines.length ? <span className={ui.dialogMeta}>{lines.length}/5<span className="sr-only"> produtos diferentes</span></span> : null}>
    {!lines.length ? <div className={styles.cartEmpty}><EmptyState icon={ShoppingBag} title="O carrinho está vazio" text="Escolha um produto para começar sua compra." inset
        action={<button type="button" className={ui.primaryButton} onClick={onClose}>Explorar produtos</button>} /></div>
      : <form className={styles.cartForm} onSubmit={checkout}>
        <ol className={styles.checkoutSteps} aria-label="Etapas do checkout">
          <li data-state="done">Carrinho</li>
          <li data-state={signedIn ? "done" : "current"} aria-current={signedIn ? undefined : "step"}>Entrar</li>
          <li data-state={signedIn ? "current" : "todo"} aria-current={signedIn ? "step" : undefined}>Pagamento Pix</li>
        </ol>
        <div className={styles.cartLines}>{lines.map(line => {
          const name = line.product.displayName;
          const max = line.product.unlimitedStock ? 10000 : line.product.availableStock;
          return <div key={line.productId} className={styles.cartLine} style={cssVars({ "--hue": categoryVisual(line.product.category).hue })}>
            <ProductImage product={line.product} variant="thumb" />
            <div className={styles.cartLineContent}><h3>{name}</h3><p>{formatShopPrice(line.product.priceCents)} por unidade</p>
              <div className={styles.quantityControl} data-size="sm">
                <button type="button" aria-label={`Diminuir quantidade de ${name}`} disabled={busy} onClick={() => onQuantity(line.productId, line.quantity - 1)}><Minus size={14} aria-hidden="true" /></button>
                <input aria-label={`Quantidade de ${name}`} type="number" inputMode="numeric" min={1} max={max} value={line.quantity} disabled={busy}
                  onChange={event => onQuantity(line.productId, Math.max(1, Math.floor(Number(event.target.value) || 1)))} />
                <button type="button" aria-label={`Aumentar quantidade de ${name}`} disabled={busy || line.quantity >= max} onClick={() => onQuantity(line.productId, line.quantity + 1)}><Plus size={14} aria-hidden="true" /></button>
              </div></div>
            <div className={styles.cartLinePrice}><strong>{formatShopPrice(line.product.priceCents * line.quantity)}</strong>
              <button type="button" className={`${ui.iconButton} ${styles.remove}`} disabled={busy} aria-label={`Remover ${name}`} onClick={() => onQuantity(line.productId, 0)}><Trash2 size={16} aria-hidden="true" /></button></div>
          </div>;
        })}</div>
        {lines.length >= 5 ? <p className={styles.limitNote}><Info size={16} aria-hidden="true" />Você atingiu o limite de 5 produtos diferentes por pedido.</p> : null}
        <div className={styles.cartSection}>{signedIn ? <>
          <label className={ui.field}>Seu usuário no Roblox<input required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" autoComplete="off" placeholder="Nome da conta que receberá o item" value={nickname} disabled={busy} aria-describedby={hintId} onChange={event => setNickname(event.target.value)} /></label>
          <p id={hintId} className={ui.fieldHint}>Informe o nome de usuário, não o nome de exibição.</p>
          {services.length ? <div className={styles.requirements}><h3><ShieldAlert size={16} aria-hidden="true" />Requisitos dos serviços</h3>
            {services.map(line => <div key={line.productId} className={styles.requirementItem}><strong>{line.product.displayName}</strong>{line.product.serviceRequirements.map((item, i) => <p key={i}>{item}</p>)}</div>)}
            <label className={`${ui.checkLabel} ${styles.confirm}`}><input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Li os requisitos e minha conta atende ao necessário.</label>
          </div> : null}
        </> : <div className={styles.loginNote}><Emblem icon={UserRound} size="m" />
          <div><h3>Finalize com sua conta</h3><p>Entre com Google, Discord ou e-mail para pagar e acompanhar a entrega no chat do site. Seu carrinho será mantido.</p></div></div>}</div>
        <div className={styles.cartFooter}>
          <div className={styles.totalRow}><span>Total dos produtos</span><strong>{formatShopPrice(total)}</strong></div>
          <p className={styles.footNote}>O valor final será confirmado no pedido.</p>
          {/* Inside the sticky footer, so a long cart can never scroll it out of sight. */}
          {error ? <p id={errorId} className={`${ui.error} ${styles.cartError}`} role="alert">{error}</p> : null}
          {signedIn
            ? <button ref={submitRef} type="submit" className={cta} disabled={busy || total <= 0} aria-describedby={error ? errorId : undefined}>{busy ? <><LoaderCircle className={ui.spinner} size={18} aria-hidden="true" /> Preparando pedido…</> : <>Continuar para o pagamento<ArrowRight size={18} aria-hidden="true" /></>}</button>
            : total > 0 ? <a href={loginHref} className={cta}>Entrar e finalizar<ArrowRight size={18} aria-hidden="true" /></a>
              : <button type="button" className={cta} disabled>Entrar e finalizar<ArrowRight size={18} aria-hidden="true" /></button>}
          <p className={styles.checkoutNote}>Depois do pagamento, o chat desta compra fica disponível aqui no site para combinar a entrega.</p>
        </div>
      </form>}
  </ShopDialog>;
}
