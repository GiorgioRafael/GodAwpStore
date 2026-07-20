import { NextResponse } from "next/server";

import { discordBotRequest } from "@/lib/bot/discord-api";
import {
  discordAccountCreatedAt,
  discordAvatarUrl,
  discordDisplayName,
  fetchDiscordOAuthUser,
} from "@/lib/giveaways/discord-oauth";
import {
  addDiscordGuildMember,
  getDiscordGuildMembership,
} from "@/lib/giveaways/discord-membership";
import {
  GIVEAWAY_OAUTH_COOKIE,
  getGiveawayOAuthStateSecret,
  verifyGiveawayOAuthState,
} from "@/lib/giveaways/oauth-state";
import { getGiveawayOAuthContext } from "@/lib/giveaways/repository";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const stateToken = requestUrl.searchParams.get("state") ?? "";
  const code = requestUrl.searchParams.get("code") ?? "";
  const cookieToken = readCookie(request.headers.get("cookie"), GIVEAWAY_OAUTH_COOKIE);
  let slug = "";

  try {
    if (!stateToken || !cookieToken || stateToken !== cookieToken || !code) {
      throw new GiveawayOAuthError("sessao_expirada");
    }
    const state = verifyGiveawayOAuthState(
      stateToken,
      getGiveawayOAuthStateSecret(),
    );
    slug = state.slug;
    const giveaway = await getGiveawayOAuthContext(state.slug, state.referralToken);
    if (!giveaway || giveaway.id !== state.giveawayId) {
      throw new GiveawayOAuthError("link_invalido");
    }
    const now = Date.now();
    if (
      (giveaway.status !== "scheduled" && giveaway.status !== "active") ||
      Date.parse(giveaway.startsAt) > now ||
      Date.parse(giveaway.endsAt) <= now
    ) {
      throw new GiveawayOAuthError("fora_do_periodo");
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new Error("Supabase não configurado.");
    const { data: authData, error: authError } = await supabase.auth.exchangeCodeForSession(code);
    const accessToken = authData.session?.provider_token;
    if (authError || !accessToken) {
      throw new GiveawayOAuthError("sessao_expirada");
    }
    const user = await fetchDiscordOAuthUser(accessToken);
    const existingMembership = await getDiscordGuildMembership(
      giveaway.discordGuildId,
      user.id,
    );
    const client = createAdminSupabaseClient();
    if (!client) throw new Error("Supabase server-only não configurado.");

    if (!state.referralToken) {
      if (!existingMembership.exists || existingMembership.pending) {
        throw new GiveawayOAuthError("membro_necessario");
      }
      const { data, error } = await client
        .rpc("register_giveaway_participant", {
          p_giveaway_id: giveaway.id,
          p_discord_user_id: user.id,
          p_display_name: discordDisplayName(user),
          p_avatar_url: discordAvatarUrl(user),
        })
        .single();
      if (error || !data) throw mapDatabaseError(error?.message);
      return successRedirect(
        requestUrl.origin,
        state.slug,
        { entrada: data.referral_token },
      );
    }

    if (existingMembership.exists) {
      throw new GiveawayOAuthError("ja_era_membro");
    }
    const accountCreatedAt = discordAccountCreatedAt(user.id);
    if (
      accountCreatedAt.getTime() >
      now - giveaway.minimumAccountAgeDays * 24 * 60 * 60 * 1_000
    ) {
      throw new GiveawayOAuthError("conta_recente");
    }
    const addedMembership = await addDiscordGuildMember(
      giveaway.discordGuildId,
      user.id,
      accessToken,
    );
    if (addedMembership.alreadyMember) throw new GiveawayOAuthError("ja_era_membro");
    const initiallyValid = giveaway.minimumStayMinutes === 0 && !addedMembership.pending;
    const { error } = await client.rpc("register_giveaway_referral", {
      p_giveaway_id: giveaway.id,
      p_referral_token: state.referralToken,
      p_invitee_discord_user_id: user.id,
      p_invitee_display_name: discordDisplayName(user),
      p_invitee_avatar_url: discordAvatarUrl(user),
      p_invitee_account_created_at: accountCreatedAt.toISOString(),
      p_initially_valid: initiallyValid,
    });
    if (error) {
      await removeJoinedMemberBestEffort(giveaway.discordGuildId, user.id);
      throw mapDatabaseError(error.message);
    }
    return successRedirect(
      requestUrl.origin,
      state.slug,
      { convite: initiallyValid ? "valido" : "em_validacao" },
    );
  } catch (error) {
    const code = error instanceof GiveawayOAuthError ? error.code : "indisponivel";
    if (!(error instanceof GiveawayOAuthError)) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      console.error(`[giveaway:oauth:callback] ${message}`);
    }
    return successRedirect(requestUrl.origin, slug, { erro: code });
  }
}

class GiveawayOAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GiveawayOAuthError";
  }
}

function successRedirect(
  origin: string,
  slug: string,
  params: Record<string, string>,
) {
  const url = new URL(slug ? `/sorteios/${slug}` : "/", origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.set(GIVEAWAY_OAUTH_COOKIE, "", {
    expires: new Date(0),
    path: "/api/sorteios/oauth/retorno",
  });
  return response;
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function mapDatabaseError(message?: string) {
  if (message?.includes("too new")) return new GiveawayOAuthError("conta_recente");
  if (message?.includes("already attributed")) return new GiveawayOAuthError("ja_atribuido");
  if (message?.includes("not accepting")) return new GiveawayOAuthError("fora_do_periodo");
  return new Error(message || "Não foi possível registrar a participação.");
}

async function removeJoinedMemberBestEffort(guildId: string, userId: string) {
  await discordBotRequest(
    `/guilds/${guildId}/members/${userId}`,
    { method: "DELETE" },
  ).catch(() => undefined);
}
