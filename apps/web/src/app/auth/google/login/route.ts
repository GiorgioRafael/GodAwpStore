import { NextResponse, type NextRequest } from "next/server";

import { AUTH_NEXT_COOKIE, AUTH_NEXT_MAX_AGE } from "@/lib/auth-next";
import { getSiteUrl } from "@/lib/env";
import { masterAdminLoginHref } from "@/lib/master-admin-auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const siteOrigin = getSiteUrl(request.nextUrl.origin);
  const next = safeInternalPath(
    request.nextUrl.searchParams.get("next"),
    siteOrigin,
    "/admin/discordbots",
  );
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.redirect(
      new URL(masterAdminLoginHref(next, { setup: true }), siteOrigin),
    );
  }

  const callback = new URL("/auth/callback", siteOrigin);
  callback.searchParams.set("next", next);

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
      new URL(masterAdminLoginHref(next, { error: "oauth" }), siteOrigin),
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
