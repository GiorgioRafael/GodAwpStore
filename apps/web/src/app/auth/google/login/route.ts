import { NextResponse, type NextRequest } from "next/server";

import { AUTH_NEXT_COOKIE, AUTH_NEXT_MAX_AGE } from "@/lib/auth-next";
import { getGwStoreLoginOrigin, getMasterAdminSiteUrl, getStoreAuthSiteUrl } from "@/lib/env";
import { gwStoreCustomerLoginHref, safeGwStoreCustomerNext } from "@/lib/gwstore-customer-auth";
import { masterAdminLoginHref } from "@/lib/master-admin-auth";
import { publicRequestOrigin } from "@/lib/public-request-origin";
import { safeInternalPath } from "@/lib/safe-redirect";
import { requireShopRequest } from "@/lib/shop/request";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const customer = request.nextUrl.searchParams.get("customer") === "1";
  const requestOrigin = publicRequestOrigin(request);
  if (customer) {
    try {
      requireShopRequest(request);
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }
  const siteOrigin = customer
    ? getStoreAuthSiteUrl(requestOrigin)
    : getMasterAdminSiteUrl(request.nextUrl.origin);
  const next = customer
    ? safeGwStoreCustomerNext(request.nextUrl.searchParams.get("next"), siteOrigin)
    : safeInternalPath(request.nextUrl.searchParams.get("next"), siteOrigin, "/admin/discordbots");
  const loginOrigin = customer ? getGwStoreLoginOrigin() : null;
  if (loginOrigin && requestOrigin !== loginOrigin) {
    const target = new URL("/auth/google/login", loginOrigin);
    target.searchParams.set("customer", "1");
    target.searchParams.set("next", next);
    return NextResponse.redirect(target);
  }
  // Create the PKCE cookie only after the browser reaches the callback's host.
  if (!customer && request.nextUrl.origin !== siteOrigin) {
    const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, siteOrigin);
    return NextResponse.redirect(target);
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.redirect(
      new URL(customer
        ? gwStoreCustomerLoginHref(next, { setup: true })
        : masterAdminLoginHref(next, { setup: true }), siteOrigin),
    );
  }

  const callback = new URL("/auth/callback", siteOrigin);
  // Keep the production callback URL exact. Supabase matches redirect allow-list
  // entries against the full URL, so appending `next` makes it fall back to the
  // GWStore Site URL. The short-lived, HttpOnly cookie below carries the target.

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
      scopes: "openid email profile",
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      new URL(customer
        ? gwStoreCustomerLoginHref(next, { error: "oauth" })
        : masterAdminLoginHref(next, { error: "oauth" }), siteOrigin),
    );
  }

  const response = NextResponse.redirect(data.url);
  response.cookies.set(AUTH_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: siteOrigin.startsWith("https:"),
    path: "/",
    maxAge: AUTH_NEXT_MAX_AGE,
  });
  return response;
}
