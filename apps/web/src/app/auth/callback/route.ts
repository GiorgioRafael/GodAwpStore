import { NextResponse, type NextRequest } from "next/server";

import { getMasterAdminSiteUrl, getStoreAuthSiteUrl } from "@/lib/env";
import { publicRequestOrigin } from "@/lib/public-request-origin";
import { AUTH_NEXT_COOKIE } from "@/lib/auth-next";
import { CUSTOMER_RECOVERY_COOKIE, CUSTOMER_RECOVERY_MAX_AGE } from "@/lib/customer-auth-state";
import { gwStoreCustomerLoginHref, isGwStoreCustomerDestination, safeGwStoreCustomerNext } from "@/lib/gwstore-customer-auth";
import { isMasterAdminPath, masterAdminLoginHref } from "@/lib/master-admin-auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestOrigin = publicRequestOrigin(request);
  const code = request.nextUrl.searchParams.get("code");
  // The query string is the primary carrier and the cookie is what survives a
  // provider that rewrites it. Both are re-validated: a cookie is still input.
  const requested =
    request.nextUrl.searchParams.get("next") ??
    request.cookies.get(AUTH_NEXT_COOKIE)?.value ??
    null;
  const next = safeInternalPath(requested, requestOrigin);
  const siteOrigin = isMasterAdminPath(next, requestOrigin)
    ? getMasterAdminSiteUrl(requestOrigin)
    : getStoreAuthSiteUrl(requestOrigin);
  const supabase = await createServerSupabaseClient();

  if (!code || !supabase) {
    return failed(siteOrigin, next, requestOrigin);
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return failed(siteOrigin, next, requestOrigin);
  }

  // Supabase keeps the recovery intent alongside the host-scoped PKCE
  // verifier. It is used only after the code has established a session.
  const isRecovery = data && "redirectType" in data && data.redirectType === "recovery"
    && data.session && data.user?.id && isGwStoreCustomerDestination("/", requestOrigin);
  const isCustomerDefault = !requested && isGwStoreCustomerDestination("/", requestOrigin);
  const target = isRecovery
    ? new URL(`/entrar?${new URLSearchParams({ mode: "reset", next: safeGwStoreCustomerNext(next, siteOrigin) })}`, siteOrigin)
    : new URL(isCustomerDefault ? "/" : next, siteOrigin);
  const response = NextResponse.redirect(target);
  if (isRecovery) {
    response.cookies.set(CUSTOMER_RECOVERY_COOKIE, data.user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: siteOrigin.startsWith("https:"),
      path: "/",
      maxAge: CUSTOMER_RECOVERY_MAX_AGE,
    });
  } else {
    response.cookies.delete(CUSTOMER_RECOVERY_COOKIE);
  }
  response.cookies.delete(AUTH_NEXT_COOKIE);
  return response;
}

/**
 * A failed login goes back where it started. Sending everyone to the panel
 * login told a player, in the store's own words, that the panel is for
 * authorised IDs only — which reads as a refusal, not as "try again".
 */
function failed(siteOrigin: string, next: string, requestOrigin: string) {
  const target = isMasterAdminPath(next, siteOrigin)
    ? new URL(masterAdminLoginHref(next, { error: "callback" }), siteOrigin)
    : isGwStoreCustomerDestination(next, requestOrigin)
      ? new URL(gwStoreCustomerLoginHref(next, { error: "callback" }), siteOrigin)
      : next.startsWith("/roleta")
      ? new URL("/roleta?erro=login", siteOrigin)
      : new URL("/login?erro=callback", siteOrigin);
  const response = NextResponse.redirect(target);
  response.cookies.delete(CUSTOMER_RECOVERY_COOKIE);
  response.cookies.delete(AUTH_NEXT_COOKIE);
  return response;
}
