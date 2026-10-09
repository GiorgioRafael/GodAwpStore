import { IS_GWSTORE } from "./brand";

const STORE_PANEL_PATHS = new Set([
  "/dashboard", "/auditoria", "/catalogo/jogos", "/catalogo/produtos", "/catalogo/sublojas",
  "/configuracoes", "/customizacao-bot", "/estoque", "/entregas", "/metricas-roleta",
  "/pagamentos-pix", "/pedidos", "/resgates", "/saldos", "/saques", "/servidores",
  "/sorteios", "/whitelist",
]);

/** URLs shown to the shop owner; the THStore keeps its existing addresses. */
export function storeAdminHref(path: string): string {
  if (!IS_GWSTORE) return path;
  const [pathname] = path.split(/[?#]/, 1);
  const suffix = path.slice(pathname.length);
  if (pathname === "/" || pathname === "/dashboard") return `/admin${suffix}`;
  return STORE_PANEL_PATHS.has(pathname) ? `/admin${path}` : path;
}

/** Panel links returned to the master dashboard also need the shop prefix. */
export function storeAdminUrl(url: string): string {
  const parsed = new URL(url);
  const pathname = storeAdminHref(parsed.pathname);
  if (pathname === parsed.pathname) return url;
  parsed.pathname = pathname;
  return parsed.toString();
}

/** Use the request URL, never forwarded host headers, to choose the panel. */
export function isGwStoreAdminOrigin(origin: string): boolean {
  if (!IS_GWSTORE) return false;
  const hostname = parseHostname(origin);
  if (!hostname || hostname === "101devs.com" || hostname === "www.101devs.com"
    || hostname === parseHostname(process.env.MASTER_ADMIN_SITE_URL)) return false;
  const hosts = ["gwstoreofc.com", "www.gwstoreofc.com", "gwstore.vercel.app", "localhost", "127.0.0.1", "[::1]"];
  for (const configured of [process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const configuredHost = parseHostname(configured);
    if (configuredHost) hosts.push(configuredHost);
  }
  return hosts.includes(hostname);
}

/** Only map exact shop routes; public giveaways and master tabs are separate. */
export function storeAdminRewritePath(pathname: string, origin: string): string | null {
  if (!isGwStoreAdminOrigin(origin)) return null;
  const path = trimTrailingSlash(pathname);
  if (path === "/admin" || path === "/admin/dashboard") return "/dashboard";
  const internal = path.startsWith("/admin/") ? path.slice("/admin".length) : "";
  return STORE_PANEL_PATHS.has(internal) ? internal : null;
}

export function legacyStoreAdminRedirect(pathname: string, origin: string): string | null {
  if (!isGwStoreAdminOrigin(origin)) return null;
  const path = trimTrailingSlash(pathname);
  if (path === "/admin/dashboard") return "/admin";
  return STORE_PANEL_PATHS.has(path) ? storeAdminHref(path) : null;
}

export function defaultStoreAdminPath(origin?: string): string {
  return origin && isGwStoreAdminOrigin(origin) ? "/admin" : "/dashboard";
}

function trimTrailingSlash(path: string) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function parseHostname(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return (url.protocol === "https:" || url.protocol === "http:") ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}
