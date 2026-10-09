import { NextResponse, type NextRequest } from "next/server";

import { getMasterAdminSiteUrl, getStoreAuthSiteUrl } from "@/lib/env";
import { publicRequestOrigin } from "@/lib/public-request-origin";
import { isGwStoreCustomerDestination } from "@/lib/gwstore-customer-auth";
import { isMasterAdminPath, masterAdminLoginHref } from "@/lib/master-admin-auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const requestOrigin = publicRequestOrigin(request);
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();

  const requestedNext = request.nextUrl.searchParams.get("next");
  const next = safeInternalPath(requestedNext, requestOrigin, "/");
  const isMasterAdmin = isMasterAdminPath(next, requestOrigin);
  const siteOrigin = isMasterAdmin ? getMasterAdminSiteUrl(requestOrigin) : getStoreAuthSiteUrl(requestOrigin);
  const isCustomer = requestedNext !== null && isGwStoreCustomerDestination(requestedNext, requestOrigin);
  const login = isMasterAdmin ? masterAdminLoginHref(next) : isCustomer ? "/" : "/login";
  return NextResponse.redirect(new URL(login, siteOrigin), { status: 303 });
}
