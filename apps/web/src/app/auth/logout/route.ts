import { NextResponse, type NextRequest } from "next/server";

import { getSiteUrl } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();

  return NextResponse.redirect(new URL("/login", getSiteUrl(request.nextUrl.origin)), { status: 303 });
}
