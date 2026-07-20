import { NextResponse } from "next/server";

import { getSiteUrl } from "@/lib/env";
import {
  createGiveawayOAuthState,
  GIVEAWAY_OAUTH_COOKIE,
  getGiveawayOAuthStateSecret,
} from "@/lib/giveaways/oauth-state";
import { getGiveawayOAuthContext } from "@/lib/giveaways/repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_PATTERN = /^[a-z0-9]{12,32}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const slug = requestUrl.searchParams.get("slug")?.trim().toLowerCase() ?? "";
  const referralToken = requestUrl.searchParams.get("ref")?.trim().toLowerCase() || null;
  if (!SLUG_PATTERN.test(slug) || (referralToken && !UUID_PATTERN.test(referralToken))) {
    return redirectToGiveaway(requestUrl.origin, slug, "link_invalido");
  }

  try {
    const giveaway = await getGiveawayOAuthContext(slug, referralToken);
    if (!giveaway) return redirectToGiveaway(requestUrl.origin, slug, "link_invalido");
    const now = Date.now();
    if (
      (giveaway.status !== "scheduled" && giveaway.status !== "active") ||
      Date.parse(giveaway.startsAt) > now ||
      Date.parse(giveaway.endsAt) <= now
    ) {
      return redirectToGiveaway(requestUrl.origin, slug, "fora_do_periodo");
    }

    const secret = getGiveawayOAuthStateSecret();
    const state = createGiveawayOAuthState(
      { giveawayId: giveaway.id, slug: giveaway.slug, referralToken },
      secret,
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new Error("Supabase não configurado.");
    const callback = new URL(
      "/api/sorteios/oauth/retorno",
      getSiteUrl(requestUrl.origin),
    );
    callback.searchParams.set("state", state);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: callback.toString(),
        scopes: "identify guilds.join",
      },
    });
    if (error || !data.url) throw new Error(error?.message || "OAuth Discord indisponível.");
    const response = NextResponse.redirect(data.url);
    response.cookies.set(GIVEAWAY_OAUTH_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: "/api/sorteios/oauth/retorno",
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[giveaway:oauth:start] ${message}`);
    return redirectToGiveaway(requestUrl.origin, slug, "configuracao");
  }
}

function redirectToGiveaway(origin: string, slug: string, error: string) {
  const safeSlug = SLUG_PATTERN.test(slug) ? slug : "";
  const url = new URL(safeSlug ? `/sorteios/${safeSlug}` : "/", origin);
  url.searchParams.set("erro", error);
  return NextResponse.redirect(url);
}
