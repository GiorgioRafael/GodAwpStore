import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseServerConfig } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

export function createAdminSupabaseClient() {
  const config = getSupabaseServerConfig();

  if (!config) {
    return null;
  }

  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
