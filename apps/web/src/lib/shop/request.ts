import "server-only";
import { IS_GWSTORE } from "@/lib/brand";
import { isGwStoreAdminOrigin } from "@/lib/store-admin-routes";
import { publicRequestOrigin } from "@/lib/public-request-origin";
import { extractShopBuyerIdentity, parseAdminDiscordIds } from "@/lib/auth-identity";
import { getAdminSession } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ShopError } from "./errors";
import type { ShopActor } from "./types";

export function requireShopRequest(request: Request, mutation = false): string {
  const origin = publicRequestOrigin(request);
  const url = new URL(origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const production = process.env.NODE_ENV === "production";
  if (!IS_GWSTORE || !isGwStoreAdminOrigin(origin) || url.username || url.password
    || (production && (url.protocol !== "https:" || local || url.port))) throw new ShopError("not_found");
  if (mutation) {
    const submitted = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (submitted !== origin || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
      throw new ShopError("forbidden");
    }
  }
  return origin;
}

export async function requireShopBuyer() {
  const client = await createServerSupabaseClient();
  if (!client) throw new ShopError("unavailable");
  const { data, error } = await client.auth.getUser();
  if (error) throw new ShopError("unauthenticated");
  const identity = data.user ? extractShopBuyerIdentity(data.user) : null;
  if (!identity) throw new ShopError("unauthenticated");
  return identity;
}

export async function requireShopActor(adminOnly = false): Promise<ShopActor> {
  const identity = await requireShopBuyer();
  let isAdmin = false;
  if (identity.discordId && parseAdminDiscordIds().has(identity.discordId)) {
    const session = await getAdminSession();
    if (session.status === "error" || session.status === "unconfigured") throw new ShopError("unavailable");
    isAdmin = session.status === "authorized" && session.identity.authUserId === identity.authUserId;
  }
  if (adminOnly && !isAdmin) throw new ShopError("forbidden");
  return { ...identity, isAdmin };
}
