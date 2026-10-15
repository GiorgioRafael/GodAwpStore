"use client";

import type { FocusEvent } from "react";
import { ChevronRight } from "lucide-react";
import { formatShopPrice, shopServiceHint, type ShopProductView } from "@/lib/shop/catalog-view";
import { ProductImage } from "./product-image";
import { Emblem } from "./shop-ui";
import { categoryVisual, cssVars, serviceGroupIcon } from "./shop-visuals";
import styles from "./catalog.module.css";

type ServiceGroup = { id: string; name: string; anchor: string; items: ShopProductView[] };

/** Buckets the (filtered, sorted) services into their sub-groups, in catalog order; empty groups are dropped. */
function groupServices(categoryProducts: ShopProductView[], visible: ShopProductView[]) {
  const groups = new Map<string, ServiceGroup>();
  const groupOf = (product: ShopProductView) => {
    let group = groups.get(product.groupId);
    if (!group) groups.set(product.groupId, group = { id: product.groupId, name: product.groupName, anchor: product.groupAnchor, items: [] });
    return group;
  };
  categoryProducts.forEach(groupOf);
  visible.forEach(product => groupOf(product).items.push(product));
  return [...groups.values()].filter(group => group.items.length);
}

// Buttons, not hash links: a hash change fires popstate, which resets search and sort.
function jumpTo(anchor: string) {
  const target = document.getElementById(anchor);
  target?.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  target?.querySelector("h2")?.focus({ preventScroll: true });
}

/** onFocus for a horizontal scroll row: browsers leave a partly visible focused item where it is, so this moves the row
 * (never the page, so no scrollIntoView) until the item clears the 16px/32px edge fades and, on mobile, the sort select.
 * It always lands an item's start on the 16px inset, a snap position, so the index's proximity snap cannot pull it back.
 * Keyboard focus only: scrolling under a pointer between mousedown and mouseup would swallow the click or tap. */
export function revealFocused(event: FocusEvent<HTMLElement>) {
  const row = event.currentTarget, item = event.target;
  if (item === row || !item.matches(":focus-visible")) return;
  const box = row.getBoundingClientRect(), start = (el: Element) => el.getBoundingClientRect().left - box.left - 16;
  const left = start(item), need = item.getBoundingClientRect().right - box.right + 32;
  const delta = left < 0 ? left : need > 0 ? Math.min(left, ...[...row.children].map(start).filter(x => x >= need)) : 0;
  if (delta) row.scrollLeft += delta;
}

/** Serviços de UP as a printed price list: sub-groups with emblem headings, hints and leader dots. */
export function ServiceList({ categoryProducts, visible, grouped, showIndex, onOpen }: {
  categoryProducts: ShopProductView[]; visible: ShopProductView[]; grouped: boolean; showIndex: boolean;
  onOpen: (product: ShopProductView) => void;
}) {
  if (!grouped) return <div className={styles.serviceRows}>
    {visible.map((product, index) => <ServiceRow key={product.id} product={product} index={index} flat onOpen={onOpen} />)}
  </div>;
  const groups = groupServices(categoryProducts, visible);
  return <>
    {showIndex && groups.length >= 3 ? <nav className={styles.serviceIndex} aria-label="Grupos de serviços"><ul onFocus={revealFocused}>
      {groups.map(group => {
        const Icon = serviceGroupIcon(group.name);
        return <li key={group.id}><button type="button" aria-label={`Ir para ${group.name}`} onClick={() => jumpTo(group.anchor)}>
          <Icon size={16} aria-hidden="true" /><span>{group.name}</span>
          <span className={styles.indexCount} aria-hidden="true">{group.items.length}</span></button></li>;
      })}
    </ul></nav> : null}
    {groups.map(group => <div key={group.id} id={group.anchor} className={styles.serviceGroup}>
      <div className={styles.serviceGroupHeader}><Emblem icon={serviceGroupIcon(group.name)} size="s" />
        <h2 tabIndex={-1}>{group.name}</h2>
        <span className={styles.groupCount}>{group.items.length} {group.items.length === 1 ? "serviço" : "serviços"}</span></div>
      <div className={styles.serviceRows}>
        {group.items.map((product, index) => <ServiceRow key={product.id} product={product} index={index} onOpen={onOpen} />)}
      </div>
    </div>)}
  </>;
}

/** An <article> with one h3; the tile button's ::after stretches over the whole row (one tab stop). */
function ServiceRow({ product: p, index, flat = false, onOpen }: {
  product: ShopProductView; index: number; flat?: boolean; onOpen: (product: ShopProductView) => void;
}) {
  const available = Boolean(p.unlimitedStock || p.availableStock > 0);
  const hint = flat ? [p.groupName, shopServiceHint(p)].filter(Boolean).join(" · ") : shopServiceHint(p);
  return <article className={styles.serviceRow} data-available={available} data-hint={hint ? "" : undefined}
    style={cssVars({ "--hue": categoryVisual(p.category).hue, "--i": Math.min(index, 11) })}>
    <button type="button" className={styles.serviceOpen} aria-label={`Ver ${p.displayName}`} onClick={() => onOpen(p)}><ProductImage product={p} variant="tile" /></button>
    <div className={styles.serviceText}><h3>{p.displayName}</h3>{hint ? <p className={styles.serviceHint}>{hint}</p> : null}</div>
    <span className={styles.serviceLeader} aria-hidden="true" />
    <span className={styles.servicePriceCol}><strong className={styles.servicePrice}>{formatShopPrice(p.priceCents)}</strong>
      {!available ? <span className={styles.serviceSold}>Indisponível</span> : null}</span>
    <ChevronRight className={styles.serviceChevron} size={18} aria-hidden="true" />
  </article>;
}
