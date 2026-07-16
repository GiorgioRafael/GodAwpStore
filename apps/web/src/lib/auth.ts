import "server-only";

import { redirect } from "next/navigation";

import {
  extractDiscordIdentity,
  parseAdminDiscordIds,
  type AdminIdentity,
} from "@/lib/auth-identity";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type { AdminIdentity } from "@/lib/auth-identity";

export type AdminSession =
  | { status: "unconfigured"; identity: null }
  | { status: "error"; identity: null }
  | { status: "unauthenticated"; identity: null }
  | { status: "unauthorized"; identity: AdminIdentity }
  | { status: "authorized"; identity: AdminIdentity };

async function recordAdminProfile(identity: AdminIdentity) {
  const adminClient = createAdminSupabaseClient();
  if (!adminClient) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await adminClient
    .from("admin_profiles")
    .upsert(
      {
        auth_user_id: identity.authUserId,
        discord_user_id: identity.discordId,
        display_name: identity.displayName,
        avatar_url: identity.avatarUrl,
        authorization_expires_at: new Date(Date.now() + 2 * 60 * 1_000).toISOString(),
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "auth_user_id" },
    )
    .select("is_active")
    .single();

  if (error || !data) throw new Error(`Unable to record the admin profile: ${error?.code ?? "unknown"}`);
  return data.is_active;
}

export async function getAdminSession(): Promise<AdminSession> {
  const supabase = await createServerSupabaseClient();
  if (!supabase || !createAdminSupabaseClient()) {
    return { status: "unconfigured", identity: null };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { status: "unauthenticated", identity: null };
  }

  const identity = extractDiscordIdentity(data.user);
  if (!identity) {
    return { status: "unauthenticated", identity: null };
  }

  if (!parseAdminDiscordIds().has(identity.discordId)) {
    return { status: "unauthorized", identity };
  }

  try {
    const active = await recordAdminProfile(identity);
    if (!active) return { status: "unauthorized", identity };
  } catch {
    return { status: "error", identity: null };
  }
  return { status: "authorized", identity };
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const session = await getAdminSession();

  if (session.status === "unconfigured") redirect("/login?setup=1");
  if (session.status === "error") redirect("/login?erro=configuracao");
  if (session.status === "unauthenticated") redirect("/login");
  if (session.status === "unauthorized") redirect("/acesso-negado");

  return session.identity;
}
