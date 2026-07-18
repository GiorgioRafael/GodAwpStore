const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_OPTION_VALUE_LENGTH = 100;
const MAXIMUM_EMBEDDED_NAME_LENGTH = 60;

export type DiscordCartSelection = {
  productId: string;
  productName: string | null;
};

/**
 * Embeds the already-public product label in the select value so Discord can
 * open the quantity modal without waiting for a database round trip.
 * Authoritative product data is still loaded and validated on submission.
 */
export function encodeDiscordCartSelection(productId: string, productName: string) {
  if (!UUID_PATTERN.test(productId)) throw new Error("ID de produto inválido.");
  const normalizedName = normalizeProductName(productName);
  const value = `${productId}:${normalizedName}`;
  if (value.length > MAXIMUM_OPTION_VALUE_LENGTH) {
    throw new Error("Nome de produto excede o limite do seletor Discord.");
  }
  return value;
}

export function decodeDiscordCartSelection(value: unknown): DiscordCartSelection | null {
  if (typeof value !== "string" || value.length > MAXIMUM_OPTION_VALUE_LENGTH) return null;

  // Compatibility with storefront messages published before product labels
  // were embedded. These open a generic but still fast quantity modal.
  if (UUID_PATTERN.test(value)) return { productId: value, productName: null };

  const productId = value.slice(0, 36);
  if (value[36] !== ":" || !UUID_PATTERN.test(productId)) return null;
  const productName = normalizeProductName(value.slice(37));
  return productName ? { productId, productName } : null;
}

function normalizeProductName(value: string) {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Produto";
  return normalized.length <= MAXIMUM_EMBEDDED_NAME_LENGTH
    ? normalized
    : `${normalized.slice(0, MAXIMUM_EMBEDDED_NAME_LENGTH - 3)}...`;
}
