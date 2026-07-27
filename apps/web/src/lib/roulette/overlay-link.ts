import "server-only";

import { getAdminSession } from "@/lib/auth";
import { getSiteUrl } from "@/lib/env";

export type RouletteOverlayLink =
  | { status: "ready"; url: string }
  | { status: "forbidden" }
  | { status: "unconfigured"; missing: "token" | "site-url" };

/**
 * Address the operator pastes into OBS or TikTok Studio. The overlay runs
 * without a session, so the token in the query string is the only thing gating
 * it — the link is a password.
 *
 * The authorization check lives here rather than only in the admin layout on
 * purpose. A layout redirect does not stop the page underneath from rendering:
 * an unauthenticated GET to an (admin) route answers 307 but still carries that
 * page's own server output in the body. Every other admin page survives that
 * because its data comes through the caller's Supabase session and RLS returns
 * nothing; this token comes straight from the environment and would be handed
 * to anybody who asked.
 */
export async function getRouletteOverlayLink(): Promise<RouletteOverlayLink> {
  const session = await getAdminSession();
  if (session.status !== "authorized") return { status: "forbidden" };

  const token = process.env.ROULETTE_OVERLAY_TOKEN?.trim();
  if (!token) return { status: "unconfigured", missing: "token" };

  let siteUrl: string;
  try {
    siteUrl = getSiteUrl();
  } catch {
    // getSiteUrl throws in production without NEXT_PUBLIC_SITE_URL; a missing
    // origin must not take the whole metrics page down with it.
    return { status: "unconfigured", missing: "site-url" };
  }

  const url = new URL("/roleta/overlay", siteUrl);
  url.searchParams.set("token", token);
  return { status: "ready", url: url.toString() };
}
