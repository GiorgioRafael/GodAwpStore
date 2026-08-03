import "server-only";

import { redirect } from "next/navigation";

import {
  extractGoogleIdentity,
  parseMasterAdminGoogleEmails,
  type MasterAdminIdentity,
} from "@/lib/auth-identity";
import {
  MASTER_ADMIN_ACCESS_DENIED,
  MASTER_ADMIN_ROOT,
  masterAdminLoginHref,
} from "@/lib/master-admin-auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type MasterAdminSession =
  | { status: "unconfigured"; identity: null }
  | { status: "error"; identity: null }
  | { status: "unauthenticated"; identity: null }
  | { status: "unauthorized"; identity: MasterAdminIdentity }
  | { status: "authorized"; identity: MasterAdminIdentity };

async function recordMasterAdminProfile(identity: MasterAdminIdentity) {
  const adminClient = createAdminSupabaseClient();
  if (!adminClient) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await adminClient
    .from("admin_profiles")
    .upsert(
      {
        auth_user_id: identity.authUserId,
        google_email: identity.email,
        display_name: identity.displayName,
        avatar_url: identity.avatarUrl,
        authorization_expires_at: new Date(Date.now() + 2 * 60 * 1_000).toISOString(),
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "auth_user_id" },
    )
    .select("is_active")
    .single();

  if (error || !data) {
    throw new Error(`Unable to record the master admin profile: ${error?.code ?? "unknown"}`);
  }
  return data.is_active;
}

export async function getMasterAdminSession(): Promise<MasterAdminSession> {
  const supabase = await createServerSupabaseClient();
  if (!supabase || !createAdminSupabaseClient()) {
    return { status: "unconfigured", identity: null };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { status: "unauthenticated", identity: null };
  }

  const identity = extractGoogleIdentity(data.user);
  if (!identity) {
    return { status: "unauthenticated", identity: null };
  }

  if (!parseMasterAdminGoogleEmails().has(identity.email)) {
    return { status: "unauthorized", identity };
  }

  try {
    const active = await recordMasterAdminProfile(identity);
    if (!active) return { status: "unauthorized", identity };
  } catch {
    return { status: "error", identity: null };
  }

  return { status: "authorized", identity };
}

export async function requireMasterAdmin(): Promise<MasterAdminIdentity> {
  const session = await getMasterAdminSession();

  if (session.status === "unconfigured") {
    redirect(masterAdminLoginHref(MASTER_ADMIN_ROOT, { setup: true }));
  }
  if (session.status === "error") {
    redirect(masterAdminLoginHref(MASTER_ADMIN_ROOT, { error: "configuracao" }));
  }
  if (session.status === "unauthenticated") {
    redirect(masterAdminLoginHref());
  }
  if (session.status === "unauthorized") redirect(MASTER_ADMIN_ACCESS_DENIED);

  return session.identity;
}
