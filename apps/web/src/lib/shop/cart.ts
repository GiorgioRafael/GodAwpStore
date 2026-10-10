import type { CartItemInput } from "@/lib/bot/types";
import { MAXIMUM_CART_ITEMS } from "@/lib/bot/types";
import { MAXIMUM_ORDER_QUANTITY } from "@/lib/livepix/limits";
import type { ShopCatalogProduct } from "./types";

export type ShopCartItem = CartItemInput;
export type ShopCartLine = ShopCartItem;
export type ShopCartProduct = Pick<ShopCatalogProduct, "id" | "priceCents" | "availableStock" | "unlimitedStock"> & {
  minimumQuantity?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persisted/browser input is untrusted. Keep only IDs and quantities, never prices. */
export function parseShopCart(raw: unknown): ShopCartItem[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw) as unknown; } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const result: ShopCartItem[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.productId !== "string" || !UUID.test(item.productId)
      || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1
      || Number(item.quantity) > MAXIMUM_ORDER_QUANTITY) continue;
    const productId = item.productId.toLowerCase();
    if (seen.has(productId)) continue;
    seen.add(productId);
    result.push({ productId, quantity: Number(item.quantity) });
    if (result.length === MAXIMUM_CART_ITEMS) break;
  }
  return result;
}

export function shopProductQuantityBounds(product: ShopCartProduct): { minimum: number; maximum: number } | null {
  const minimum = product.minimumQuantity ?? 1;
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > MAXIMUM_ORDER_QUANTITY) return null;
  if (product.unlimitedStock === true) return { minimum, maximum: MAXIMUM_ORDER_QUANTITY };
  if (!Number.isSafeInteger(product.availableStock) || product.availableStock < minimum) return null;
  return { minimum, maximum: Math.min(product.availableStock, MAXIMUM_ORDER_QUANTITY) };
}

/** Refresh against the current public catalog; missing/paused/sold-out items disappear. */
export function hydrateShopCart(raw: unknown, products: readonly ShopCartProduct[]): ShopCartItem[] {
  const catalog = productMap(products);
  return parseShopCart(raw).flatMap(item => {
    const product = catalog.get(item.productId);
    const bounds = product && shopProductQuantityBounds(product);
    if (!bounds) return [];
    return [{ productId: item.productId, quantity: Math.max(bounds.minimum, Math.min(item.quantity, bounds.maximum)) }];
  });
}

/** Zero removes an item; adding a sixth distinct item leaves the current cart intact. */
export function setShopCartQuantity(
  cart: readonly ShopCartItem[], productId: string, quantity: number, products: readonly ShopCartProduct[],
): ShopCartItem[] {
  const current = hydrateShopCart(cart, products);
  if (!UUID.test(productId) || !Number.isSafeInteger(quantity)) return current;
  const id = productId.toLowerCase();
  if (quantity <= 0) return current.filter(item => item.productId !== id);
  const product = productMap(products).get(id);
  const bounds = product && shopProductQuantityBounds(product);
  if (!bounds) return current;
  const normalized = Math.max(bounds.minimum, Math.min(quantity, bounds.maximum));
  if (current.some(item => item.productId === id)) {
    return current.map(item => item.productId === id ? { productId: id, quantity: normalized } : item);
  }
  return current.length >= MAXIMUM_CART_ITEMS ? current : [...current, { productId: id, quantity: normalized }];
}

/** An estimate from the current catalog. Only the checkout server sets the payable total. */
export function shopCartSubtotalCents(cart: readonly ShopCartItem[], products: readonly ShopCartProduct[]): number | null {
  const catalog = productMap(products);
  let total = 0;
  for (const item of hydrateShopCart(cart, products)) {
    const lineTotal = catalog.get(item.productId)!.priceCents * item.quantity;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal)) return null;
    total += lineTotal;
  }
  return total;
}

/** Login/storage handoff carries the same IDs/quantities shape as checkout.items. */
export function encodeShopCartHandoff(cart: readonly ShopCartItem[]): string {
  const items = parseShopCart(cart);
  if (items.length !== cart.length) throw new Error("Carrinho inválido.");
  return JSON.stringify(items);
}

/** Choose a login method at checkout and reopen the same cart afterwards. */
export function shopCheckoutLoginHref(cart: readonly ShopCartItem[]): string {
  const next = `/?${new URLSearchParams({ checkout: "1", cart: encodeShopCartHandoff(cart) })}`;
  return `/entrar?${new URLSearchParams({ next })}`;
}

function productMap(products: readonly ShopCartProduct[]) {
  const result = new Map<string, ShopCartProduct>();
  for (const product of products) {
    if (UUID.test(product.id) && Number.isSafeInteger(product.priceCents) && product.priceCents > 0) {
      result.set(product.id.toLowerCase(), product);
    }
  }
  return result;
}
