import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isPublicAdminPanelPath } from "@/lib/admin-routes";
import { extractDiscordIdentity, parseAdminDiscordIds } from "@/lib/auth-identity";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data } = await supabase.auth.getUser();

  // The panel is gated here, before anything renders. requireAdmin() in the
  // (admin) layout redirects but does not stop the page underneath from
  // rendering, so its output — anything the page put in the payload, including
  // values that never pass through RLS — still travels with the 307.
  if (!isPublicAdminPanelPath(request.nextUrl.pathname)) {
    const identity = data.user ? extractDiscordIdentity(data.user) : null;
    if (!identity) return redirectPreservingSession(request, response, "/login");
    if (!parseAdminDiscordIds().has(identity.discordId)) {
      return redirectPreservingSession(request, response, "/acesso-negado");
    }
  }

  return response;
}

/** A refreshed session must survive the redirect, or the next hop loops. */
function redirectPreservingSession(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  const redirect = NextResponse.redirect(target);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
