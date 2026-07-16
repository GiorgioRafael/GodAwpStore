import { DEFAULT_TIME_ZONE } from "./constants";
import { commissionBpsSchema, moneyCentsSchema } from "./schemas";

export interface ParseBrlOptions {
  allowNegative?: boolean;
}
export interface CommissionBreakdown {
  minimumPriceCents: number;
  salePriceCents: number;
  grossProfitCents: number;
  commissionBps: number;
  commissionCents: number;
  sellerProfitCents: number;
}

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} deve ser um inteiro seguro.`);
  }
}

export function parseBrlToCents(input: string, options: ParseBrlOptions = {}): number {
  if (typeof input !== "string") {
    throw new TypeError("O valor em BRL deve ser informado como texto.");
  }

  let normalized = input.trim().replace(/\u00a0/g, " ");
  normalized = normalized.replace(/^R\$\s*/i, "").replace(/\s+/g, "");

  if (normalized.length === 0) {
    throw new TypeError("Informe um valor em BRL.");
  }

  let negative = false;
  if (normalized.startsWith("-")) {
    negative = true;
    normalized = normalized.slice(1);
  } else if (normalized.startsWith("+")) {
    normalized = normalized.slice(1);
  }

  if (negative && !options.allowNegative) {
    throw new RangeError("O valor em BRL não pode ser negativo.");
  }

  const [integerPart, fractionPart, extraPart] = normalized.split(",");
  if (extraPart !== undefined || integerPart === undefined) {
    throw new TypeError("Use o formato brasileiro, por exemplo 1.234,56.");
  }

  const validInteger = /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(integerPart);
  const validFraction = fractionPart === undefined || /^\d{1,2}$/.test(fractionPart);

  if (!validInteger || !validFraction) {
    throw new TypeError("Use o formato brasileiro, por exemplo 1.234,56.");
  }

  const wholeDigits = integerPart.replaceAll(".", "");
  const whole = BigInt(wholeDigits);
  const fraction = fractionPart === undefined ? 0n : BigInt(fractionPart.padEnd(2, "0"));
  const signedCents = (whole * 100n + fraction) * (negative ? -1n : 1n);

  if (signedCents > BigInt(Number.MAX_SAFE_INTEGER) || signedCents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("O valor em BRL excede o limite seguro.");
  }

  return Number(signedCents);
}

export function formatBrl(cents: number): string {
  assertSafeInteger(cents, "O valor em centavos");
  return brlFormatter.format(cents / 100);
}

export const formatBrlCents = formatBrl;

export function formatDateTimePtBr(
  value: Date | string | number,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Data inválida.");
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

export function formatDatePtBr(
  value: Date | string | number,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Data inválida.");
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone,
  }).format(date);
}

export function calculateEffectiveCommissionBps(
  globalCommissionBps: number,
  commissionOverrideBps: number | null | undefined,
): number {
  const globalRate = commissionBpsSchema.parse(globalCommissionBps);
  return commissionOverrideBps == null
    ? globalRate
    : commissionBpsSchema.parse(commissionOverrideBps);
}

export function calculateCommission(input: {
  minimumPriceCents: number;
  salePriceCents: number;
  commissionBps: number;
}): CommissionBreakdown {
  const minimumPriceCents = moneyCentsSchema.parse(input.minimumPriceCents);
  const salePriceCents = moneyCentsSchema.parse(input.salePriceCents);
  const commissionBps = commissionBpsSchema.parse(input.commissionBps);

  if (salePriceCents < minimumPriceCents) {
    throw new RangeError("O preço de venda não pode ficar abaixo do preço mínimo.");
  }

  const grossProfitCents = salePriceCents - minimumPriceCents;
  // Half-up: a fração de um centavo é arredondada para o centavo mais próximo.
  const commissionCents = Number(
    (BigInt(grossProfitCents) * BigInt(commissionBps) + 5_000n) / 10_000n,
  );
  const sellerProfitCents = grossProfitCents - commissionCents;

  return {
    minimumPriceCents,
    salePriceCents,
    grossProfitCents,
    commissionBps,
    commissionCents,
    sellerProfitCents,
  };
}

export function calculateSalePriceFromMarkup(
  minimumPriceCents: number,
  markupPercentage: number,
): number {
  const minimum = moneyCentsSchema.parse(minimumPriceCents);
  if (!Number.isFinite(markupPercentage) || markupPercentage < 0) {
    throw new RangeError("A porcentagem de margem deve ser um número não negativo.");
  }

  const markupBps = Math.round(markupPercentage * 100);
  assertSafeInteger(markupBps, "A porcentagem de margem");
  const price =
    (BigInt(minimum) * BigInt(10_000 + markupBps) + 5_000n) / 10_000n;

  if (price > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("O preço calculado excede o limite seguro.");
  }

  return Number(price);
}
