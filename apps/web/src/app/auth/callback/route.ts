import { NextResponse, type NextRequest } from "next/server";

import { getMasterAdminSiteUrl, getSiteUrl } from "@/lib/env";
import { AUTH_NEXT_COOKIE } from "@/lib/auth-next";
import { isMasterAdminPath, masterAdminLoginHref } from "@/lib/master-admin-auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  // The query string is the primary carrier and the cookie is what survives a
  // provider that rewrites it. Both are re-validated: a cookie is still input.
  const requested =
    request.nextUrl.searchParams.get("next") ??
    request.cookies.get(AUTH_NEXT_COOKIE)?.value ??
    null;
  const next = safeInternalPath(requested, request.nextUrl.origin);
  const siteOrigin = isMasterAdminPath(next)
    ? getMasterAdminSiteUrl(request.nextUrl.origin)
    : getSiteUrl(request.nextUrl.origin);
  const supabase = await createServerSupabaseClient();

  if (!code || !supabase) {
    return failed(siteOrigin, next);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return failed(siteOrigin, next);
  }

  const response = NextResponse.redirect(new URL(next, siteOrigin));
  response.cookies.delete(AUTH_NEXT_COOKIE);
  return response;
}

/**
 * A failed login goes back where it started. Sending everyone to the panel
 * login told a player, in the store's own words, that the panel is for
 * authorised IDs only — which reads as a refusal, not as "try again".
 */
function failed(siteOrigin: string, next: string) {
  const target = isMasterAdminPath(next)
    ? new URL(masterAdminLoginHref(next, { error: "callback" }), siteOrigin)
    : next.startsWith("/roleta")
      ? new URL("/roleta?erro=login", siteOrigin)
      : new URL("/login?erro=callback", siteOrigin);
  const response = NextResponse.redirect(target);
  response.cookies.delete(AUTH_NEXT_COOKIE);
  return response;
}
