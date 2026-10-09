import { NextResponse, type NextRequest } from "next/server";

import { getMasterAdminSiteUrl, getStoreAuthSiteUrl } from "@/lib/env";
import { publicRequestOrigin } from "@/lib/public-request-origin";
import { isMasterAdminPath, masterAdminLoginHref } from "@/lib/master-admin-auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const requestOrigin = publicRequestOrigin(request);
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();

  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), requestOrigin, "/");
  const isMasterAdmin = isMasterAdminPath(next, requestOrigin);
  const siteOrigin = isMasterAdmin ? getMasterAdminSiteUrl(requestOrigin) : getStoreAuthSiteUrl(requestOrigin);
  const login = isMasterAdmin ? masterAdminLoginHref(next) : "/login";
  return NextResponse.redirect(new URL(login, siteOrigin), { status: 303 });
}
