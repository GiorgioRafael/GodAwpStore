import { NextResponse, type NextRequest } from "next/server";

import { getSiteUrl } from "@/lib/env";
import { isMasterAdminPath, masterAdminLoginHref } from "@/lib/master-admin-auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();

  const siteOrigin = getSiteUrl(request.nextUrl.origin);
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), siteOrigin, "/");
  const login = isMasterAdminPath(next) ? masterAdminLoginHref(next) : "/login";
  return NextResponse.redirect(new URL(login, siteOrigin), { status: 303 });
}
