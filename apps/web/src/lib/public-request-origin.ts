import { IS_GWSTORE } from "./brand";

const GW_PUBLIC_HOSTS = new Set(["gwstore.vercel.app", "gwstoreofc.com", "www.gwstoreofc.com"]);
const LOCAL_BINDING_HOSTS = new Set(["0.0.0.0", "127.0.0.1", "localhost"]);

/** Resolve the browser origin only through the narrowly scoped Railway bridge. */
export function publicRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  if (!IS_GWSTORE || !process.env.RAILWAY_ENVIRONMENT_ID?.trim()
    || !process.env.RAILWAY_SERVICE_ID?.trim()) return url.origin;

  const railwayHosts = configuredRailwayHosts();
  const production = process.env.NODE_ENV === "production";
  let actualHost: string;
  let protocol = url.protocol;
  if (railwayHosts.has(url.hostname) && !url.port && !url.username && !url.password
    && (url.protocol === "https:" || (!production && url.protocol === "http:"))) {
    actualHost = url.hostname;
  } else if (isLocalRailwayBinding(url)) {
    const host = request.headers.get("host")?.toLowerCase() ?? "";
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    if ((!railwayHosts.has(host) && !GW_PUBLIC_HOSTS.has(host))
      || (forwardedProtocol !== "https" && (production || forwardedProtocol !== "http"))) {
      return url.origin;
    }
    actualHost = host;
    protocol = `${forwardedProtocol}:`;
  } else {
    // Direct shop/master requests never trust forwarded-host input.
    return url.origin;
  }

  // A direct request to a shop host needs no forwarded-host interpretation.
  if (GW_PUBLIC_HOSTS.has(actualHost)) return `${protocol}//${actualHost}`;
  const forwardedHost = request.headers.get("x-forwarded-host")?.toLowerCase() ?? "";
  const publicHost = GW_PUBLIC_HOSTS.has(forwardedHost) ? forwardedHost : actualHost;
  return `${protocol}//${publicHost}`;
}

function configuredRailwayHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const configured of [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.RAILWAY_STATIC_URL]) {
    if (!configured?.trim()) continue;
    try {
      const value = configured.trim();
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (url.protocol === "https:" && !url.port && !url.username && !url.password
        && url.pathname === "/" && !url.search && !url.hash
        && url.hostname.endsWith(".railway.app")) hosts.add(url.hostname);
    } catch {
      // Invalid deployment aliases never establish a trusted bridge host.
    }
  }
  return hosts;
}

function isLocalRailwayBinding(url: URL): boolean {
  const configuredPort = process.env.PORT?.trim() ?? "";
  if (!/^[0-9]{1,5}$/.test(configuredPort) || Number(configuredPort) < 1
    || Number(configuredPort) > 65_535 || !LOCAL_BINDING_HOSTS.has(url.hostname)
    || url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return false;
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return Number(port) === Number(configuredPort);
}
