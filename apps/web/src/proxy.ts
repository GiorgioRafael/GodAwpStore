import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isPublicAdminPanelPath } from "@/lib/admin-routes";
import { IS_GWSTORE } from "@/lib/brand";
import { isGwStoreAdminOrigin, legacyStoreAdminRedirect, storeAdminRewritePath } from "@/lib/store-admin-routes";
import { shouldProxyGwStoreToRailway } from "@/lib/railway-bridge";
import { publicRequestOrigin } from "@/lib/public-request-origin";
import {
  extractDiscordIdentity,
  extractGoogleIdentity,
  parseAdminDiscordIds,
  parseMasterAdminGoogleEmails,
} from "@/lib/auth-identity";
import {
  MASTER_ADMIN_ACCESS_DENIED,
  isMasterAdminPath,
  masterAdminLoginHref,
} from "@/lib/master-admin-auth";

export async function proxy(request: NextRequest) {
  const origin = publicRequestOrigin(request);
  const pathname = request.nextUrl.pathname;
  // Rewrites run after this proxy. Railway must receive the untouched URL and
  // own its session refresh/auth checks, rather than authenticate twice here.
  if (shouldProxyGwStoreToRailway(origin, pathname)) return NextResponse.next({ request });
  const isStoreOrigin = isGwStoreAdminOrigin(origin);
  const rewritePath = storeAdminRewritePath(pathname, origin);
  const legacyRedirect = (request.method === "GET" || request.method === "HEAD")
    ? legacyStoreAdminRedirect(pathname, origin) : null;
  const isSharedPixLink = IS_GWSTORE && request.method === "GET" && pathname.replace(/\/$/, "") === "/pagamentos-pix";
  const isPublic = isPublicAdminPanelPath(pathname) || (isStoreOrigin && pathname === "/");
  const isMasterAdmin = isMasterAdminPath(pathname, origin);
  const next = `${pathname}${request.nextUrl.search}`;

  // Historical links move before rendering. POSTs keep reaching their Server Actions.
  if (legacyRedirect && !isSharedPixLink) {
    const target = new URL(`${legacyRedirect}${request.nextUrl.search}`, origin);
    return NextResponse.redirect(target);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    if (!isPublic) {
      const login = isMasterAdmin ? masterAdminLoginHref(next, { setup: true }) : "/login";
      return redirectPreservingSession(request, NextResponse.next(), login,
        isMasterAdmin ? undefined : { setup: "1", next });
    }
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
  if (!isPublic) {
    if (isMasterAdmin) {
      const identity = data.user ? extractGoogleIdentity(data.user) : null;
      if (!identity) {
        return redirectPreservingSession(request, response, masterAdminLoginHref(next));
      }
      if (!parseMasterAdminGoogleEmails().has(identity.email)) {
        return redirectPreservingSession(request, response, MASTER_ADMIN_ACCESS_DENIED);
      }
      return response;
    }

    const identity = data.user ? extractDiscordIdentity(data.user) : null;
    const isAdmin = identity ? parseAdminDiscordIds().has(identity.discordId) : false;

    // O endereço deste relatório já foi compartilhado com compradores. Para
    // eles, abre o checkout público; o relatório continua acessível só a admins.
    if (
      isSharedPixLink &&
      !isAdmin
    ) {
      return redirectPreservingSession(request, response, "/pagar");
    }
    if (legacyRedirect) {
      const target = new URL(`${legacyRedirect}${request.nextUrl.search}`, origin);
      const redirect = NextResponse.redirect(target);
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
    if (!identity) {
      return redirectPreservingSession(request, response, "/login", { next });
    }
    if (!isAdmin) {
      return redirectPreservingSession(request, response, "/acesso-negado");
    }
  }

  if (rewritePath) {
    const target = request.nextUrl.clone();
    target.pathname = rewritePath;
    const rewritten = NextResponse.rewrite(target, { request });
    for (const cookie of response.cookies.getAll()) rewritten.cookies.set(cookie);
    return rewritten;
  }
  return response;
}

/** A refreshed session must survive the redirect, or the next hop loops. */
function redirectPreservingSession(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
  searchParams?: Record<string, string>,
) {
  const target = new URL(pathname, publicRequestOrigin(request));
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    target.searchParams.set(key, value);
  }
  const redirect = NextResponse.redirect(target);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|discordbots-assets/|vc-ap-dfea66/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
