import { NextResponse, type NextRequest } from "next/server";

import { getSiteUrl } from "@/lib/env";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const siteOrigin = getSiteUrl(request.nextUrl.origin);
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login?setup=1", siteOrigin));
  }

  const next = safeInternalPath(request.nextUrl.searchParams.get("next"), siteOrigin);
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
    return NextResponse.redirect(new URL("/login?erro=oauth", siteOrigin));
  }

  return NextResponse.redirect(data.url);
}
