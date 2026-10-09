import { describe, expect, it } from "vitest";
import { MAXIMUM_ORDER_QUANTITY } from "@/lib/livepix/limits";
import {
  encodeShopCartHandoff, hydrateShopCart, parseShopCart, setShopCartQuantity,
  shopCartSubtotalCents, shopProductQuantityBounds, type ShopCartProduct,
} from "./cart";

const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const products: ShopCartProduct[] = ids.map(id => ({ id, priceCents: 500, availableStock: 10 }));

describe("shop cart hydration", () => {
  it("accepts JSON but strips prices, names and other client fields", () => {
    expect(parseShopCart(JSON.stringify([{ productId: ids[0].toUpperCase(), quantity: 2, priceCents: 1, name: "Fake" }])))
      .toEqual([{ productId: ids[0], quantity: 2 }]);
  });

  it.each(["{broken", "null", "{}", null, 5])("ignores malformed or non-array storage: %s", raw => {
    expect(parseShopCart(raw)).toEqual([]);
  });

  it("drops invalid IDs and quantities rather than coercing strings/fractions", () => {
    const input = [
      { productId: "bad", quantity: 2 },
      ...[0, -1, 1.5, "2", NaN, Infinity, MAXIMUM_ORDER_QUANTITY + 1].map(quantity => ({ productId: ids[0], quantity })),
      { productId: ids[1], quantity: 1 },
    ];
    expect(parseShopCart(input)).toEqual([{ productId: ids[1], quantity: 1 }]);
  });

  it("keeps at most five unique products without duplicating saved lines", () => {
    expect(parseShopCart([{ productId: ids[0], quantity: 2 }, ...ids.map(productId => ({ productId, quantity: 1 }))]))
      .toEqual([{ productId: ids[0], quantity: 2 }, ...ids.slice(1, 5).map(productId => ({ productId, quantity: 1 }))]);
  });

  it("restores only available catalog items and clamps down after stock changes", () => {
    const saved = ids.slice(0, 4).map(productId => ({ productId, quantity: 5 }));
    expect(hydrateShopCart(saved, [products[0], { ...products[1], availableStock: 2 }, { ...products[2], availableStock: 0 }]))
      .toEqual([{ productId: ids[0], quantity: 5 }, { productId: ids[1], quantity: 2 }]);
  });

  it("keeps unlimited products even with zero finite stock, bounded by the backend cap", () => {
    const unlimited = { ...products[0], availableStock: 0, unlimitedStock: true };
    expect(shopProductQuantityBounds(unlimited)).toEqual({ minimum: 1, maximum: MAXIMUM_ORDER_QUANTITY });
    expect(setShopCartQuantity([], ids[0], MAXIMUM_ORDER_QUANTITY + 1, [unlimited]))
      .toEqual([{ productId: ids[0], quantity: MAXIMUM_ORDER_QUANTITY }]);
  });

  it("respects product minimums and refuses a product with less stock than its minimum", () => {
    const packageProduct = { ...products[0], minimumQuantity: 3 };
    expect(hydrateShopCart([{ productId: ids[0], quantity: 1 }], [packageProduct]))
      .toEqual([{ productId: ids[0], quantity: 3 }]);
    expect(shopProductQuantityBounds({ ...packageProduct, availableStock: 2 })).toBeNull();
    expect(shopProductQuantityBounds({ ...packageProduct, minimumQuantity: 0 })).toBeNull();
  });

  it("updates existing lines at the five-line limit but refuses a sixth product", () => {
    const cart = ids.slice(0, 5).map(productId => ({ productId, quantity: 1 }));
    expect(setShopCartQuantity(cart, ids[5], 1, products)).toEqual(cart);
    expect(setShopCartQuantity(cart, ids[0], 3, products)[0].quantity).toBe(3);
    expect(setShopCartQuantity(cart, ids[0], 0, products)).toEqual(cart.slice(1));
  });

  it("ignores fractional edits and does not mutate the original cart", () => {
    const cart = [{ productId: ids[0], quantity: 1 }];
    expect(setShopCartQuantity(cart, ids[0], 1.5, products)).toEqual(cart);
    setShopCartQuantity(cart, ids[0], 2, products);
    expect(cart[0].quantity).toBe(1);
  });

  it("estimates with fresh catalog prices and refuses unsafe arithmetic", () => {
    const cart = [{ productId: ids[0], quantity: 2 }, { productId: ids[1], quantity: 1 }];
    expect(shopCartSubtotalCents(cart, products)).toBe(1500);
    expect(shopCartSubtotalCents(cart, [{ ...products[0], priceCents: 800 }, products[1]])).toBe(2100);
    expect(shopCartSubtotalCents(cart, [{ ...products[0], priceCents: Number.MAX_SAFE_INTEGER }])).toBeNull();
  });

  it("encodes checkout IDs and quantities only and rejects a lossy handoff", () => {
    const cart = [{ productId: ids[0], quantity: 2, priceCents: 1 }];
    expect(encodeShopCartHandoff(cart)).toBe(JSON.stringify([{ productId: ids[0], quantity: 2 }]));
    expect(() => encodeShopCartHandoff([...cart, ...cart])).toThrow("Carrinho inválido.");
    expect(() => encodeShopCartHandoff(ids.map(productId => ({ productId, quantity: 1 })))).toThrow("Carrinho inválido.");
  });
});
