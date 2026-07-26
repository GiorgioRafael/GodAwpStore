const DEFAULT_SLUG = "produto";
const DEFAULT_MAX_LENGTH = 80;

export function slugFromName(value: string, maximumLength = DEFAULT_MAX_LENGTH): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const fallback = normalized || DEFAULT_SLUG;

  return fallback.slice(0, maximumLength).replace(/-+$/g, "") || DEFAULT_SLUG;
}

export function uniqueSlug(
  baseSlug: string,
  existingSlugs: Iterable<string>,
  maximumLength = DEFAULT_MAX_LENGTH,
): string {
  const existing = new Set(Array.from(existingSlugs, (slug) => slug.toLowerCase()));
  if (!existing.has(baseSlug.toLowerCase())) return baseSlug;

  for (let sequence = 2; ; sequence += 1) {
    const suffix = `-${sequence}`;
    const root =
      baseSlug.slice(0, maximumLength - suffix.length).replace(/-+$/g, "") || DEFAULT_SLUG;
    const candidate = `${root}${suffix}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
}
