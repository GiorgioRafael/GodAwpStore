import { NextResponse, type NextRequest } from "next/server";

import { getGwStoreLoginOrigin, getStoreAuthSiteUrl } from "@/lib/env";
import { publicRequestOrigin } from "@/lib/public-request-origin";
import { AUTH_NEXT_COOKIE, AUTH_NEXT_MAX_AGE } from "@/lib/auth-next";
import { gwStoreCustomerLoginHref, isGwStoreCustomerDestination } from "@/lib/gwstore-customer-auth";
import { isMasterAdminPath, masterAdminLoginHref } from "@/lib/master-admin-auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestOrigin = publicRequestOrigin(request);
  const siteOrigin = getStoreAuthSiteUrl(requestOrigin);
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), siteOrigin);
  const isCustomer = isGwStoreCustomerDestination(next, requestOrigin);
  const loginOrigin = getGwStoreLoginOrigin();
  if (loginOrigin && requestOrigin !== loginOrigin && !isMasterAdminPath(next, requestOrigin)) {
    const target = new URL("/auth/login", loginOrigin);
    target.searchParams.set("next", next);
    // Redirect before the SSR client can write a host-scoped PKCE verifier.
    return NextResponse.redirect(target);
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    const login = isMasterAdminPath(next, requestOrigin)
      ? masterAdminLoginHref(next, { setup: true })
      : isCustomer ? gwStoreCustomerLoginHref(next, { setup: true }) : "/login?setup=1";
    return NextResponse.redirect(new URL(login, siteOrigin));
  }

  const callback = new URL("/auth/callback", siteOrigin);
  callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo: callback.toString(),
      scopes: "identify email",
    },
  });

  if (error || !data.url) {
    const login = isMasterAdminPath(next, requestOrigin)
      ? masterAdminLoginHref(next, { error: "oauth" })
      : isCustomer ? gwStoreCustomerLoginHref(next, { error: "oauth" }) : "/login?erro=oauth";
    return NextResponse.redirect(new URL(login, siteOrigin));
  }

  const response = NextResponse.redirect(data.url);
  // Where to land is also kept here, not only in the callback URL. The query
  // string makes a round trip through Supabase and Discord; anything that drops
  // it sends the player to the fallback, which is inside the panel, and the
  // panel answers a non-administrator with "acesso não autorizado" — a login
  // that worked, reported as a login that was refused.
  response.cookies.set(AUTH_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: siteOrigin.startsWith("https:"),
    path: "/",
    maxAge: AUTH_NEXT_MAX_AGE,
  });
  return response;
}
