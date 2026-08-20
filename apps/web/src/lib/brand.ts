const DEFAULT_NAME = "GWStore";
const DEFAULT_CATALOG_LABEL = "Grow a Garden 2";
const MAXIMUM_NAME_LENGTH = 40;
const MAXIMUM_CATALOG_LABEL_LENGTH = 80;

export const DEFAULT_STORE_NAME = DEFAULT_NAME;
export const STORE_NAME = normalizePublicLabel(
  process.env.NEXT_PUBLIC_STORE_NAME,
  DEFAULT_NAME,
  MAXIMUM_NAME_LENGTH,
);
export const STORE_CATALOG_LABEL = normalizePublicLabel(
  process.env.NEXT_PUBLIC_STORE_CATALOG_LABEL,
  DEFAULT_CATALOG_LABEL,
  MAXIMUM_CATALOG_LABEL_LENGTH,
);
export const STORE_LOGO_URL = normalizePublicLogoUrl(
  process.env.NEXT_PUBLIC_STORE_LOGO_URL,
);
export const STORE_NAME_UPPER = STORE_NAME.toLocaleUpperCase("pt-BR");
export const STORE_SLUG =
  STORE_NAME
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "store";
// GodAwp Store é o nome legado da GWStore no deployment original. Os dois
// identificadores representam a mesma loja e precisam habilitar os recursos
// exclusivos dela durante a transição de marca.
export const IS_GWSTORE = STORE_SLUG === "gwstore" || STORE_SLUG === "godawp-store";
export const STORE_INITIALS =
  STORE_NAME
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("pt-BR")
    .slice(0, 3) || "ST";
export const USE_DEFAULT_STORE_LOGO =
  STORE_NAME.toLocaleLowerCase("pt-BR") === DEFAULT_NAME.toLocaleLowerCase("pt-BR") &&
  !STORE_LOGO_URL;

function normalizePublicLabel(
  value: string | undefined,
  fallback: string,
  maximumLength: number,
) {
  const normalized = value
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maximumLength) : fallback;
}

function normalizePublicLogoUrl(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    return normalized.slice(0, 2_048);
  }
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString().slice(0, 2_048) : null;
  } catch {
    return null;
  }
}
