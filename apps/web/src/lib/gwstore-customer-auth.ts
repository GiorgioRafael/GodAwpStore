import { IS_GWSTORE } from "./brand";
import { safeInternalPath } from "./safe-redirect";
import { isGwStoreAdminOrigin } from "./store-admin-routes";

const CUSTOMER_ORDER_PATH = /^\/minhas-compras\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/i;

function isCustomerDestinationPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/minhas-compras"
    || pathname === "/minhas-compras/" || CUSTOMER_ORDER_PATH.test(pathname);
}

/** Only these shop pages bypass the admin gate; their APIs still authorize data. */
export function isGwStoreCustomerPagePath(pathname: string): boolean {
  return IS_GWSTORE && (pathname === "/entrar" || pathname === "/entrar/"
    || isCustomerDestinationPath(pathname));
}

/** Customer checkout returns to the shop; it never opens a panel route. */
export function safeGwStoreCustomerNext(value: string | null, siteOrigin: string): string {
  const next = safeInternalPath(value, siteOrigin, "/");
  return isCustomerDestinationPath(new URL(next, siteOrigin).pathname) ? next : "/";
}

/** An explicit shop destination distinguishes customer OAuth from admin OAuth. */
export function isGwStoreCustomerDestination(next: string, siteOrigin: string): boolean {
  if (!IS_GWSTORE || !isGwStoreAdminOrigin(siteOrigin)) return false;
  const safe = safeInternalPath(next, siteOrigin, "");
  return Boolean(safe) && isCustomerDestinationPath(new URL(safe, siteOrigin).pathname);
}

export function gwStoreCustomerLoginHref(
  next: string,
  feedback?: { setup?: boolean; error?: string },
): string {
  const query = new URLSearchParams({ next });
  if (feedback?.setup) query.set("setup", "1");
  if (feedback?.error) query.set("erro", feedback.error);
  return `/entrar?${query.toString()}`;
}
