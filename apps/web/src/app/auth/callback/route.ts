import { NextResponse, type NextRequest } from "next/server";

import { getSiteUrl } from "@/lib/env";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const siteOrigin = getSiteUrl(request.nextUrl.origin);
  const code = request.nextUrl.searchParams.get("code");
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), siteOrigin);
  const supabase = await createServerSupabaseClient();

  if (!code || !supabase) {
    return NextResponse.redirect(new URL("/login?erro=callback", siteOrigin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?erro=callback", siteOrigin));
  }

  return NextResponse.redirect(new URL(next, siteOrigin));
}
