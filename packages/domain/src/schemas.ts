import { z } from "zod";

import {
  CATALOG_STATUSES,
  CURRENCY,
  INVENTORY_IMPORT_FORMATS,
  INVENTORY_UNIT_STATUSES,
  LEDGER_ENTRY_STATUSES,
  LEDGER_ENTRY_TYPES,
  ORDER_STATUSES,
  PAYOUT_STATUSES,
} from "./constants";

const requiredText = (label: string, maximum: number) =>
  z
    .string({ error: `${label} deve ser texto.` })
    .trim()
    .min(1, `${label} é obrigatório.`)
    .max(maximum, `${label} deve ter no máximo ${maximum} caracteres.`);

const nullableUrlSchema = z.url("URL inválida.").max(2_048).nullable();

export const uuidSchema = z.uuid("UUID inválido.");

export const discordIdSchema = z
  .string({ error: "O ID do Discord deve ser texto." })
  .trim()
  .regex(/^\d{17,20}$/, "Informe um ID do Discord válido.");

export const moneyCentsSchema = z
  .number({ error: "O valor deve ser numérico." })
  .int("O valor deve estar em centavos inteiros.")
  .nonnegative("O valor não pode ser negativo.")
  .safe("O valor excede o limite seguro.");

export const signedMoneyCentsSchema = z
  .number({ error: "O valor deve ser numérico." })
  .int("O valor deve estar em centavos inteiros.")
  .safe("O valor excede o limite seguro.");

export const commissionBpsSchema = z
  .number({ error: "A comissão deve ser numérica." })
  .int("A comissão deve estar em pontos-base inteiros.")
  .min(0, "A comissão não pode ser negativa.")
  .max(10_000, "A comissão não pode ser maior que 100%.");

export const catalogStatusSchema = z.enum(CATALOG_STATUSES);
export const inventoryUnitStatusSchema = z.enum(INVENTORY_UNIT_STATUSES);
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const ledgerEntryTypeSchema = z.enum(LEDGER_ENTRY_TYPES);
export const ledgerEntryStatusSchema = z.enum(LEDGER_ENTRY_STATUSES);
export const payoutStatusSchema = z.enum(PAYOUT_STATUSES);
export const inventoryImportFormatSchema = z.enum(INVENTORY_IMPORT_FORMATS);

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor hexadecimal no formato #RRGGBB.")
  .transform((value) => value.toUpperCase());

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug é obrigatório.")
  .max(80, "Slug deve ter no máximo 80 caracteres.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens no slug.");

export const gameInputSchema = z.object({
  name: requiredText("Nome", 120),
  slug: slugSchema,
  description: z.string().trim().max(2_000).nullable().default(null),
  imageUrl: nullableUrlSchema.default(null),
  status: catalogStatusSchema.default("active"),
  sortOrder: z.number().int().nonnegative().safe().default(0),
});

export const gameSchema = gameInputSchema.extend({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  archivedAt: isoDateTimeSchema.nullable().default(null),
});

export const substoreInputSchema = z.object({
  gameId: uuidSchema,
  name: requiredText("Nome", 120),
  slug: slugSchema,
  title: requiredText("Título", 256),
  description: requiredText("Descrição", 4_096),
  color: hexColorSchema.default("#D4AF37"),
  imageUrl: nullableUrlSchema.default(null),
  thumbnailUrl: nullableUrlSchema.default(null),
  authorName: z.string().trim().max(256).nullable().default(null),
  authorIconUrl: nullableUrlSchema.default(null),
  footerText: z.string().trim().max(2_048).nullable().default(null),
  footerIconUrl: nullableUrlSchema.default(null),
  status: catalogStatusSchema.default("active"),
  sortOrder: z.number().int().nonnegative().safe().default(0),
});

export const substoreSchema = substoreInputSchema.extend({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  archivedAt: isoDateTimeSchema.nullable().default(null),
});

export const productInputSchema = z.object({
  substoreId: uuidSchema,
  name: requiredText("Nome", 160),
  slug: slugSchema,
  description: z.string().trim().max(4_096).nullable().default(null),
  minimumPriceCents: moneyCentsSchema,
  imageUrl: nullableUrlSchema.default(null),
  status: catalogStatusSchema.default("active"),
  sortOrder: z.number().int().nonnegative().safe().default(0),
  lowStockThreshold: z.number().int().nonnegative().safe().default(5),
});

export const productSchema = productInputSchema.extend({
  id: uuidSchema,
  availableStock: z.number().int().nonnegative().safe().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  archivedAt: isoDateTimeSchema.nullable().default(null),
});

export const whitelistEntryInputSchema = z.object({
  discordId: discordIdSchema,
  active: z.boolean().default(true),
  notes: z.string().trim().max(2_000).nullable().default(null),
  commissionOverrideBps: commissionBpsSchema.nullable().default(null),
});

export const whitelistEntrySchema = whitelistEntryInputSchema.extend({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const platformSettingsSchema = z.object({
  currency: z.literal(CURRENCY).default(CURRENCY),
  globalCommissionBps: commissionBpsSchema,
  updatedAt: isoDateTimeSchema.optional(),
});

export const inventoryBatchInputSchema = z.object({
  productId: uuidSchema,
  sourceFileName: z.string().trim().min(1).max(255).nullable().default(null),
  format: inventoryImportFormatSchema.nullable().default(null),
  unitCount: z.number().int().positive().safe(),
});

export const inventoryUnitMetadataSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  batchId: uuidSchema,
  status: inventoryUnitStatusSchema,
  reservationExpiresAt: isoDateTimeSchema.nullable().default(null),
  deliveredAt: isoDateTimeSchema.nullable().default(null),
  revokedAt: isoDateTimeSchema.nullable().default(null),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const orderSummarySchema = z.object({
  id: uuidSchema,
  guildId: discordIdSchema,
  customerDiscordId: discordIdSchema,
  productId: uuidSchema,
  status: orderStatusSchema,
  salePriceCents: moneyCentsSchema,
  minimumPriceCents: moneyCentsSchema,
  grossProfitCents: moneyCentsSchema,
  commissionCents: moneyCentsSchema,
  sellerProfitCents: moneyCentsSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const ledgerEntrySchema = z.object({
  id: uuidSchema,
  ownerDiscordId: discordIdSchema,
  orderId: uuidSchema.nullable(),
  payoutId: uuidSchema.nullable(),
  type: ledgerEntryTypeSchema,
  status: ledgerEntryStatusSchema,
  amountCents: signedMoneyCentsSchema,
  createdAt: isoDateTimeSchema,
  availableAt: isoDateTimeSchema.nullable().default(null),
});

export const payoutSummarySchema = z.object({
  id: uuidSchema,
  ownerDiscordId: discordIdSchema,
  status: payoutStatusSchema,
  amountCents: moneyCentsSchema,
  requestedAt: isoDateTimeSchema,
  processedAt: isoDateTimeSchema.nullable().default(null),
});

export type GameInput = z.input<typeof gameInputSchema>;
export type Game = z.output<typeof gameSchema>;
export type SubstoreInput = z.input<typeof substoreInputSchema>;
export type Substore = z.output<typeof substoreSchema>;
export type ProductInput = z.input<typeof productInputSchema>;
export type Product = z.output<typeof productSchema>;
export type WhitelistEntryInput = z.input<typeof whitelistEntryInputSchema>;
export type WhitelistEntry = z.output<typeof whitelistEntrySchema>;
export type PlatformSettings = z.output<typeof platformSettingsSchema>;
export type InventoryBatchInput = z.input<typeof inventoryBatchInputSchema>;
export type InventoryUnitStatus = z.output<typeof inventoryUnitStatusSchema>;
export type OrderStatus = z.output<typeof orderStatusSchema>;
export type LedgerEntryType = z.output<typeof ledgerEntryTypeSchema>;
export type LedgerEntryStatus = z.output<typeof ledgerEntryStatusSchema>;
export type PayoutStatus = z.output<typeof payoutStatusSchema>;
export type CatalogStatus = z.output<typeof catalogStatusSchema>;
export type InventoryImportFormat = z.output<typeof inventoryImportFormatSchema>;
