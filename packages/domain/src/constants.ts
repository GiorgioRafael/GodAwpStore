export const CURRENCY = "BRL" as const;

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo" as const;

export const CATALOG_STATUSES = ["active", "inactive", "archived"] as const;

export const INVENTORY_UNIT_STATUSES = [
  "available",
  "reserved",
  "delivered",
  "quarantined",
  "revoked",
] as const;
export const ORDER_STATUSES = [
  "pending",
  "awaiting_payment",
  "paid",
  "processing",
  "delivered",
  "cancelled",
  "expired",
  "refunded",
  "failed",
] as const;

export const LEDGER_ENTRY_TYPES = [
  "sale_profit",
  "commission",
  "payout",
  "payout_reversal",
  "refund",
  "adjustment",
] as const;

export const LEDGER_ENTRY_STATUSES = [
  "pending",
  "available",
  "settled",
  "reversed",
] as const;

export const PAYOUT_STATUSES = [
  "requested",
  "approved",
  "processing",
  "paid",
  "rejected",
  "cancelled",
  "failed",
] as const;

export const INVENTORY_IMPORT_FORMATS = ["txt", "csv"] as const;

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
