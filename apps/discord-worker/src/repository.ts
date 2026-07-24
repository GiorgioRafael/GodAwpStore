import { createClient } from "@supabase/supabase-js";

import type { InviteSnapshot } from "./invite-attribution.js";

export type NativeInviteJoinInput = {
  discordGuildId: string;
  inviteeDiscordUserId: string;
  inviteeDisplayName: string;
  inviteeAvatarUrl: string | null;
  inviteeAccountCreatedAt: string;
  joinedAt: string;
  inviteeIsPending: boolean;
  attributionStatus: "attributed" | "ambiguous" | "unattributed" | "ignored" | "failed";
  inviteCode: string | null;
  inviterDiscordUserId: string | null;
  details: Record<string, string | number | boolean | null>;
};

export type NativeInviteJoinResult = {
  inviteEventId: string;
  eventStatus: string;
  affectedGiveawayCount: number;
  wasCreated: boolean;
};

export class NativeInviteRepository {
  private readonly client;
  private readonly guildIds = new Map<string, string>();

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  async assertConfiguredGuild(discordGuildId: string) {
    await this.resolveGuildId(discordGuildId);
  }

  async replaceSnapshots(discordGuildId: string, snapshots: readonly InviteSnapshot[]) {
    const guildId = await this.resolveGuildId(discordGuildId);
    const observedAt = new Date().toISOString();
    if (snapshots.length) {
      const { error } = await this.client
        .from("discord_native_invite_snapshots")
        .upsert(snapshots.map((snapshot) => ({
          guild_id: guildId,
          invite_code: snapshot.code,
          inviter_discord_user_id: snapshot.inviterId,
          channel_id: snapshot.channelId,
          uses: snapshot.uses,
          max_uses: snapshot.maxUses,
          created_at_discord: timestamp(snapshot.createdTimestamp),
          expires_at: timestamp(snapshot.expiresTimestamp),
          last_seen_at: observedAt,
          deleted_at: null,
        })), { onConflict: "guild_id,invite_code" });
      if (error) throw new Error(`Falha ao persistir convites: ${error.message}`);
    }

    let deletionQuery = this.client
      .from("discord_native_invite_snapshots")
      .update({ deleted_at: observedAt })
      .eq("guild_id", guildId)
      .is("deleted_at", null);
    if (snapshots.length) {
      deletionQuery = deletionQuery.lt("last_seen_at", observedAt);
    }
    const { error: deletionError } = await deletionQuery;
    if (deletionError) {
      throw new Error(`Falha ao reconciliar convites removidos: ${deletionError.message}`);
    }
  }

  async upsertSnapshot(discordGuildId: string, snapshot: InviteSnapshot) {
    const guildId = await this.resolveGuildId(discordGuildId);
    const { error } = await this.client
      .from("discord_native_invite_snapshots")
      .upsert({
        guild_id: guildId,
        invite_code: snapshot.code,
        inviter_discord_user_id: snapshot.inviterId,
        channel_id: snapshot.channelId,
        uses: snapshot.uses,
        max_uses: snapshot.maxUses,
        created_at_discord: timestamp(snapshot.createdTimestamp),
        expires_at: timestamp(snapshot.expiresTimestamp),
        last_seen_at: new Date().toISOString(),
        deleted_at: null,
      }, { onConflict: "guild_id,invite_code" });
    if (error) throw new Error(`Falha ao salvar convite: ${error.message}`);
  }

  async markSnapshotDeleted(discordGuildId: string, inviteCode: string) {
    const guildId = await this.resolveGuildId(discordGuildId);
    const deletedAt = new Date().toISOString();
    const { error } = await this.client
      .from("discord_native_invite_snapshots")
      .update({ deleted_at: deletedAt })
      .eq("guild_id", guildId)
      .eq("invite_code", inviteCode);
    if (error) throw new Error(`Falha ao marcar convite removido: ${error.message}`);
  }

  async recordJoin(input: NativeInviteJoinInput): Promise<NativeInviteJoinResult> {
    const { data, error } = await this.client
      .rpc("record_discord_native_invite_join", {
        p_discord_guild_id: input.discordGuildId,
        p_invitee_discord_user_id: input.inviteeDiscordUserId,
        p_invitee_display_name: input.inviteeDisplayName,
        p_invitee_avatar_url: input.inviteeAvatarUrl,
        p_invitee_account_created_at: input.inviteeAccountCreatedAt,
        p_joined_at: input.joinedAt,
        p_invitee_is_pending: input.inviteeIsPending,
        p_attribution_status: input.attributionStatus,
        p_invite_code: input.inviteCode,
        p_inviter_discord_user_id: input.inviterDiscordUserId,
        p_details: input.details,
      })
      .single();
    if (error || !data) {
      throw new Error(`Falha ao registrar entrada nativa: ${error?.message ?? "sem retorno"}`);
    }
    const row = data as unknown as {
      invite_event_id: string;
      event_status: string;
      affected_giveaway_count: number;
      was_created: boolean;
    };
    return {
      inviteEventId: row.invite_event_id,
      eventStatus: row.event_status,
      affectedGiveawayCount: row.affected_giveaway_count,
      wasCreated: row.was_created,
    };
  }

  private async resolveGuildId(discordGuildId: string) {
    const cached = this.guildIds.get(discordGuildId);
    if (cached) return cached;
    const { data, error } = await this.client
      .from("guilds")
      .select("id")
      .eq("discord_guild_id", discordGuildId)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    if (error) throw new Error(`Falha ao consultar servidor: ${error.message}`);
    if (!data?.id) {
      throw new Error(`Servidor Discord ${discordGuildId} não está ativo no painel.`);
    }
    const guildId = String(data.id);
    this.guildIds.set(discordGuildId, guildId);
    return guildId;
  }
}

function timestamp(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}
