import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getGwStoreLoginOrigin } from "@/lib/env";
import { safeGwStoreCustomerNext } from "@/lib/gwstore-customer-auth";
import { requireShopRequest } from "@/lib/shop/request";

/** Enter the callback host before any email form creates a PKCE verifier. */
export async function redirectCustomerAuthToLoginHost(
  next: string,
  query: { mode?: string; erro?: string; setup?: string } = {},
): Promise<void> {
  const loginOrigin = getGwStoreLoginOrigin();
  if (!loginOrigin) return;
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") === "https"
    || process.env.NODE_ENV === "production" ? "https:" : "http:";
  let origin: string;
  try {
    const host = requestHeaders.get("host");
    if (!host) notFound();
    origin = requireShopRequest(new Request(`${protocol}//${host}/entrar`, { headers: requestHeaders }));
  } catch {
    notFound();
  }
  if (origin === loginOrigin) return;
  const target = new URL("/entrar", loginOrigin);
  target.searchParams.set("next", safeGwStoreCustomerNext(next, loginOrigin));
  for (const [key, value] of Object.entries(query)) {
    if (value && value.length <= 80) target.searchParams.set(key, value);
  }
  redirect(target.toString());
}
