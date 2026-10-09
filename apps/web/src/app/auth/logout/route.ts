import { NextResponse, type NextRequest } from "next/server";

import { getMasterAdminSiteUrl, getStoreAuthSiteUrl } from "@/lib/env";
import { isMasterAdminPath, masterAdminLoginHref } from "@/lib/master-admin-auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();

  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), request.nextUrl.origin, "/");
  const isMasterAdmin = isMasterAdminPath(next, request.nextUrl.origin);
  const siteOrigin = isMasterAdmin ? getMasterAdminSiteUrl(request.nextUrl.origin) : getStoreAuthSiteUrl(request.nextUrl.origin);
  const login = isMasterAdmin ? masterAdminLoginHref(next) : "/login";
  return NextResponse.redirect(new URL(login, siteOrigin), { status: 303 });
}
