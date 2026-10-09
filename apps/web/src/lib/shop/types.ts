import type { BotCatalogGame, BotCatalogProduct, BotCatalogSubstore } from "@/lib/bot/types";

export type ShopCatalogProduct = BotCatalogProduct & {
  isUpService: boolean;
  serviceRequirements: string[];
};
export type ShopCatalogSubstore = Omit<BotCatalogSubstore, "products"> & { products: ShopCatalogProduct[] };
export type ShopCatalogGame = Omit<BotCatalogGame, "substores"> & { substores: ShopCatalogSubstore[] };

export type ShopCheckoutInput = {
  requestId: string;
  items: Array<{ productId: string; quantity: number }>;
  gameNickname: string;
  serviceRequirementsConfirmed?: boolean;
};

export type ShopOrderStatus = {
  orderId: string;
  status: string;
  paymentStatus: string;
  totalPriceCents: number;
  checkoutUrl: string | null;
  ticketUrl: string | null;
  chatUrl: string | null;
  gameNickname: string | null;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  paymentExpiresAt: string | null;
  pixCode: string | null;
  buyerName: string;
  items: ShopOrderItem[];
};

export type ShopOrderItem = { productName: string; quantity: number; unitPriceCents: number; totalPriceCents: number };
export type ShopOrderSummary = ShopOrderStatus;
export type ShopMessage = { id: string; body: string; authorRole: "buyer" | "staff" | "system"; authorName: string; createdAt: string };
export type ShopActor = { authUserId: string; discordId: string; displayName: string; isAdmin: boolean };

export type ShopErrorCode = "unavailable" | "invalid_request" | "unauthenticated" | "forbidden"
  | "product_unavailable" | "out_of_stock"
  | "total_below_minimum" | "requirements_required" | "request_conflict" | "rate_limited" | "not_found"
  | "checkout_pending" | "delivery_not_allowed";
export type ShopErrorResponse = { ok: false; error: { code: ShopErrorCode; message: string } };
export type ShopCatalogResponse = { ok: true; catalog: ShopCatalogGame[] } | ShopErrorResponse;
export type ShopCheckoutResponse = ({ ok: true } & ShopOrderStatus) | ShopErrorResponse;
