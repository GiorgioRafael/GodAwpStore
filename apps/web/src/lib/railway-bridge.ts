import { IS_GWSTORE } from "./brand";

const GWSTORE_PUBLIC_HOSTS = [
  "gwstore.vercel.app",
  "gwstoreofc.com",
  "www.gwstoreofc.com",
] as const;

// These are this store's origins, not every customer's Railway application.
const GWSTORE_RAILWAY_HOSTS = new Set(["gwstore-web-production.up.railway.app"]);

export const GWSTORE_VERCEL_CRON_PATHS = [
  "/api/cron/discord-ticket-auto-close",
  "/api/cron/discord-ticket-close-reconciliation",
  "/api/cron/discord-top-spenders",
] as const;

/** Only a dedicated HTTPS origin can activate the Vercel compatibility bridge. */
export function getGwStoreRailwayOrigin(): string | null {
  const configured = process.env.GWSTORE_RAILWAY_ORIGIN?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const authority = configured.match(/^https:\/\/([^/?#]+)\/?$/i)?.[1];
    if (!authority || authority.toLowerCase() !== url.hostname
      || !GWSTORE_RAILWAY_HOSTS.has(url.hostname)
      || url.protocol !== "https:" || url.username || url.password || url.port
      || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isGwStoreRailwayBridgeEnabled(): boolean {
  return IS_GWSTORE && process.env.VERCEL === "1"
    && !process.env.RAILWAY_ENVIRONMENT_ID?.trim()
    && !process.env.RAILWAY_SERVICE_ID?.trim()
    && getGwStoreRailwayOrigin() !== null;
}

export function isGwStoreVercelCronPath(pathname: string): boolean {
  return GWSTORE_VERCEL_CRON_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
}

/** The Railway app handles auth; the Vercel proxy must preserve the original path. */
export function shouldProxyGwStoreToRailway(origin: string, pathname: string): boolean {
  if (!isGwStoreRailwayBridgeEnabled() || isGwStoreVercelCronPath(pathname)) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && !url.port && !url.username && !url.password
      && GWSTORE_PUBLIC_HOSTS.some(host => host === url.hostname);
  } catch {
    return false;
  }
}

export function shouldSkipVercelGwStoreCron(): boolean {
  return isGwStoreRailwayBridgeEnabled();
}

/** Railway's edge may replace the forwarded host before a Server Action arrives. */
export function gwStoreRailwayServerActionOrigins(): string[] | undefined {
  return IS_GWSTORE && process.env.VERCEL !== "1"
    && process.env.RAILWAY_ENVIRONMENT_ID?.trim() && process.env.RAILWAY_SERVICE_ID?.trim()
    ? [...GWSTORE_PUBLIC_HOSTS] : undefined;
}

export function gwStoreRailwayRewrites() {
  if (!isGwStoreRailwayBridgeEnabled()) return [];
  const origin = getGwStoreRailwayOrigin()!;
  const localCrons = GWSTORE_VERCEL_CRON_PATHS.map(path => path.slice(1)).join("|");
  // Leave Vercel's authenticated cron handlers local, including a trailing slash.
  const source = `/:path((?!(?:${localCrons})(?:/|$)).*)`;
  return GWSTORE_PUBLIC_HOSTS.map(host => ({
    source,
    has: [{ type: "host" as const, value: host.replaceAll(".", "\\.") }],
    destination: `${origin}/:path*`,
  }));
}
