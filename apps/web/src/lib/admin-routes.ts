/**
 * Which paths are reachable without an administrator session.
 *
 * The list is an allow-list on purpose. A layout redirect does not stop the
 * page underneath from rendering — an unauthenticated GET to an (admin) route
 * answers 307 and still carries that page's own server output — so the gate has
 * to run before rendering, and a new admin page must be protected by the fact
 * that nobody remembered to list it.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/acesso-negado",
  "/roleta",
  "/pagamento/",
  "/auth/",
  "/api/",
  "/_next/",
  // Vercel Microfrontends prefixes the child app's static assets. These paths
  // must stay public or CSS/JS requests are redirected to /login as HTML.
  "/discordbots-assets/",
  "/vc-ap-dfea66/",
];

/** Exact paths that are public even though their prefix is not. */
const PUBLIC_EXACT = new Set(["/favicon.ico", "/icon.png", "/robots.txt", "/sitemap.xml"]);

/**
 * `/sorteios` is the admin list; `/sorteios/<slug>` is the page a player opens
 * from Discord. The prefix alone cannot tell them apart.
 */
function isPublicGiveawayPage(pathname: string) {
  return pathname.startsWith("/sorteios/") && pathname.length > "/sorteios/".length;
}

export function isPublicAdminPanelPath(pathname: string): boolean {
  const path = normalize(pathname);
  if (PUBLIC_EXACT.has(path)) return true;
  if (isPublicGiveawayPage(path)) return true;
  // The prefix has to end on a segment boundary: "/roleta" opens the roulette
  // and its overlay, never a panel page that merely starts with those letters.
  return PUBLIC_PREFIXES.some((entry) => {
    const prefix = trimTrailingSlash(entry);
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

/** Trailing slashes and duplicate slashes must not slip past the allow-list. */
function normalize(pathname: string) {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? trimTrailingSlash(collapsed) : collapsed;
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value;
}
