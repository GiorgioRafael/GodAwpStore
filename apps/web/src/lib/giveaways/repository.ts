import "server-only";

import { requireAdmin } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Enums, Tables } from "@/lib/supabase/database.types";

export type GiveawayPrizeView = Pick<
  Tables<"giveaway_prizes">,
  "product_id" | "product_name" | "quantity" | "position"
>;

export type GiveawayWinnerView = Pick<
  Tables<"giveaway_winners">,
  | "id"
  | "winner_position"
  | "discord_user_id"
  | "display_name"
  | "ticket_status"
  | "ticket_channel_id"
  | "ticket_error"
>;

export type AdminGiveawayView = Tables<"giveaways"> & {
  guildName: string;
  discordGuildId: string;
  prizes: GiveawayPrizeView[];
  winners: GiveawayWinnerView[];
  participantCount: number;
  eligibleParticipantCount: number;
};

export type PublicGiveawayView = Pick<
  Tables<"giveaways">,
  | "id"
  | "public_slug"
  | "title"
  | "description"
  | "rules_text"
  | "starts_at"
  | "ends_at"
  | "status"
  | "required_valid_invites"
  | "minimum_account_age_days"
  | "minimum_stay_minutes"
  | "winner_discord_user_id"
  | "winner_display_name"
  | "failure_reason"
> & {
  guildName: string;
  prizes: GiveawayPrizeView[];
  winners: GiveawayWinnerView[];
  entry: {
    displayName: string;
    referralToken: string;
    validInviteCount: number;
  } | null;
};

export type GiveawayOAuthContext = {
  id: string;
  slug: string;
  discordGuildId: string;
  startsAt: string;
  endsAt: string;
  status: Enums<"giveaway_status">;
  minimumAccountAgeDays: number;
  minimumStayMinutes: number;
  referralEntryId: string | null;
};

export async function listAdminGiveaways(limit = 100): Promise<AdminGiveawayView[]> {
  await requireAdmin();
  const client = await createServerSupabaseClient();
  if (!client) throw new Error("Supabase não configurado.");
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const { data: giveaways, error } = await client
    .from("giveaways")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error("Não foi possível carregar os sorteios.");
  if (!giveaways?.length) return [];

  const giveawayIds = giveaways.map((giveaway) => giveaway.id);
  const guildIds = [...new Set(giveaways.map((giveaway) => giveaway.guild_id))];
  const [prizeResult, winnerResult, entryCountResult, guildResult] = await Promise.all([
    client
      .from("giveaway_prizes")
      .select("giveaway_id,product_id,product_name,quantity,position")
      .in("giveaway_id", giveawayIds)
      .order("position"),
    client
      .from("giveaway_winners")
      .select(
        "id,giveaway_id,winner_position,discord_user_id,display_name,ticket_status,ticket_channel_id,ticket_error",
      )
      .in("giveaway_id", giveawayIds)
      .order("winner_position"),
    client.rpc("admin_giveaway_entry_counts", {
      p_giveaway_ids: giveawayIds,
    }),
    client
      .from("guilds")
      .select("id,name,discord_guild_id")
      .in("id", guildIds),
  ]);
  if (prizeResult.error || winnerResult.error || entryCountResult.error || guildResult.error) {
    throw new Error("Não foi possível carregar os detalhes dos sorteios.");
  }

  const prizes = new Map<string, GiveawayPrizeView[]>();
  for (const prize of prizeResult.data ?? []) {
    const rows = prizes.get(prize.giveaway_id) ?? [];
    rows.push(prize);
    prizes.set(prize.giveaway_id, rows);
  }
  const winners = new Map<string, GiveawayWinnerView[]>();
  for (const winner of winnerResult.data ?? []) {
    const rows = winners.get(winner.giveaway_id) ?? [];
    rows.push(winner);
    winners.set(winner.giveaway_id, rows);
  }
  const entryCounts = new Map(
    (entryCountResult.data ?? []).map((entry) => [entry.giveaway_id, entry]),
  );
  const guilds = new Map(
    (guildResult.data ?? []).map((guild) => [guild.id, guild]),
  );

  return giveaways.map((giveaway) => {
    const guild = guilds.get(giveaway.guild_id);
    const counts = entryCounts.get(giveaway.id);
    return {
      ...giveaway,
      guildName: guild?.name ?? "Servidor removido",
      discordGuildId: guild?.discord_guild_id ?? "",
      prizes: prizes.get(giveaway.id) ?? [],
      winners: winners.get(giveaway.id) ?? [],
      participantCount: Number(counts?.participant_count ?? 0),
      eligibleParticipantCount: Number(counts?.eligible_participant_count ?? 0),
    };
  });
}

export async function getPublicGiveaway(
  slug: string,
  entryAccessToken?: string | null,
): Promise<PublicGiveawayView | null> {
  const client = requireAdminClient();
  const { data: giveaway, error } = await client
    .from("giveaways")
    .select(
      "id,public_slug,guild_id,title,description,rules_text,starts_at,ends_at,status,required_valid_invites,minimum_account_age_days,minimum_stay_minutes,winner_discord_user_id,winner_display_name,failure_reason",
    )
    .eq("public_slug", slug)
    .maybeSingle();
  if (error) throw new Error("Não foi possível carregar o sorteio.");
  if (!giveaway) return null;

  const entryQuery = entryAccessToken
    ? client
        .from("giveaway_entries")
        .select("display_name,referral_token,valid_invite_count")
        .eq("giveaway_id", giveaway.id)
        .eq("access_token", entryAccessToken)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [prizeResult, winnerResult, guildResult, entryResult] = await Promise.all([
    client
      .from("giveaway_prizes")
      .select("product_id,product_name,quantity,position")
      .eq("giveaway_id", giveaway.id)
      .order("position"),
    client
      .from("giveaway_winners")
      .select(
        "id,winner_position,discord_user_id,display_name,ticket_status,ticket_channel_id,ticket_error",
      )
      .eq("giveaway_id", giveaway.id)
      .order("winner_position"),
    client.from("guilds").select("name").eq("id", giveaway.guild_id).maybeSingle(),
    entryQuery,
  ]);
  if (prizeResult.error || winnerResult.error || guildResult.error || entryResult.error) {
    throw new Error("Não foi possível carregar os detalhes do sorteio.");
  }

  return {
    ...giveaway,
    guildName: guildResult.data?.name ?? "GWStore",
    prizes: prizeResult.data ?? [],
    winners: winnerResult.data ?? [],
    entry: entryResult.data
      ? {
          displayName: entryResult.data.display_name,
          referralToken: entryResult.data.referral_token,
          validInviteCount: entryResult.data.valid_invite_count,
        }
      : null,
  };
}

export async function getGiveawayAnnouncementInput(giveawayId: string) {
  const client = requireAdminClient();
  const { data: giveaway, error } = await client
    .from("giveaways")
    .select("*")
    .eq("id", giveawayId)
    .maybeSingle();
  if (error || !giveaway) throw new Error("Sorteio não encontrado.");
  const [prizeResult, winnerResult] = await Promise.all([
    client
      .from("giveaway_prizes")
      .select("product_name,quantity,position")
      .eq("giveaway_id", giveaway.id)
      .order("position"),
    client
      .from("giveaway_winners")
      .select("winner_position,discord_user_id,display_name")
      .eq("giveaway_id", giveaway.id)
      .order("winner_position"),
  ]);
  if (prizeResult.error || !prizeResult.data?.length) {
    throw new Error("Pacote do sorteio não encontrado.");
  }
  if (winnerResult.error) throw new Error("Ganhadores do sorteio não encontrados.");
  return {
    id: giveaway.id,
    publicSlug: giveaway.public_slug,
    channelId: giveaway.publication_channel_id,
    messageId: giveaway.publication_message_id,
    title: giveaway.title,
    description: giveaway.description,
    rulesText: giveaway.rules_text,
    startsAt: giveaway.starts_at,
    endsAt: giveaway.ends_at,
    status: effectiveStatus(giveaway.status, giveaway.starts_at, giveaway.ends_at),
    requiredValidInvites: giveaway.required_valid_invites,
    minimumAccountAgeDays: giveaway.minimum_account_age_days,
    minimumStayMinutes: giveaway.minimum_stay_minutes,
    winnerDiscordUserId: giveaway.winner_discord_user_id,
    winners: (winnerResult.data ?? []).map((winner) => ({
      discordUserId: winner.discord_user_id,
      displayName: winner.display_name,
    })),
    failureReason: giveaway.failure_reason,
    prizes: prizeResult.data.map((prize) => ({
      productName: prize.product_name,
      quantity: prize.quantity,
    })),
  };
}

export async function getGiveawayOAuthContext(
  slug: string,
  referralToken?: string | null,
): Promise<GiveawayOAuthContext | null> {
  const client = requireAdminClient();
  const { data: giveaway, error } = await client
    .from("giveaways")
    .select(
      "id,public_slug,guild_id,starts_at,ends_at,status,minimum_account_age_days,minimum_stay_minutes",
    )
    .eq("public_slug", slug)
    .maybeSingle();
  if (error) throw new Error("Não foi possível validar o sorteio.");
  if (!giveaway) return null;
  const [guildResult, entryResult] = await Promise.all([
    client
      .from("guilds")
      .select("discord_guild_id")
      .eq("id", giveaway.guild_id)
      .maybeSingle(),
    referralToken
      ? client
          .from("giveaway_entries")
          .select("id")
          .eq("giveaway_id", giveaway.id)
          .eq("referral_token", referralToken)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (guildResult.error || entryResult.error || !guildResult.data) {
    throw new Error("Não foi possível validar o servidor do sorteio.");
  }
  if (referralToken && !entryResult.data) return null;
  return {
    id: giveaway.id,
    slug: giveaway.public_slug,
    discordGuildId: guildResult.data.discord_guild_id,
    startsAt: giveaway.starts_at,
    endsAt: giveaway.ends_at,
    status: giveaway.status,
    minimumAccountAgeDays: giveaway.minimum_account_age_days,
    minimumStayMinutes: giveaway.minimum_stay_minutes,
    referralEntryId: entryResult.data?.id ?? null,
  };
}

export function effectiveStatus(
  status: Enums<"giveaway_status">,
  startsAt: string,
  endsAt: string,
  now = Date.now(),
): Enums<"giveaway_status"> {
  if (status === "scheduled" && Date.parse(startsAt) <= now && Date.parse(endsAt) > now) {
    return "active";
  }
  return status;
}

export function getServerTimestamp() {
  return Date.now();
}

function requireAdminClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}
