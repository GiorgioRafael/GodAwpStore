export function safeInternalPath(
  value: string | null,
  siteOrigin: string,
  fallback = "/dashboard",
): string {
  if (!value || !value.startsWith("/") || value.includes("\\")) return fallback;

  try {
    const site = new URL(siteOrigin);
    const candidate = new URL(value, site);
    if (candidate.origin !== site.origin || candidate.username || candidate.password) return fallback;
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return fallback;
  }
}
