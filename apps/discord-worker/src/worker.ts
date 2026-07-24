import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Invite,
} from "discord.js";

import type { WorkerConfig } from "./config.js";
import type { WorkerHealth } from "./health.js";
import {
  creditsFromInviteChanges,
  discardExpiredCredits,
  type InviteCredit,
  type InviteSnapshot,
  type RecentDeletedInvite,
} from "./invite-attribution.js";
import { NativeInviteRepository } from "./repository.js";

type GuildTrackingState = {
  snapshots: Map<string, InviteSnapshot>;
  pendingCredits: InviteCredit[];
  recentDeleted: RecentDeletedInvite[];
};

export class DiscordInviteWorker {
  readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildInvites,
    ],
  });

  private readonly configuredGuildIds: Set<string>;
  private readonly repository: NativeInviteRepository;
  private readonly states = new Map<string, GuildTrackingState>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly config: WorkerConfig,
    private readonly health: WorkerHealth,
  ) {
    this.configuredGuildIds = new Set(config.discordGuildIds);
    this.repository = new NativeInviteRepository(
      config.supabaseUrl,
      config.supabaseServiceRoleKey,
    );
    this.registerEvents();
  }

  async start() {
    await this.client.login(this.config.discordBotToken);
  }

  async stop() {
    this.client.destroy();
    await Promise.allSettled(this.queues.values());
  }

  private registerEvents() {
    this.client.on(Events.ClientReady, () => {
      void this.seedConfiguredGuilds();
    });
    this.client.on(Events.GuildMemberAdd, (member) => {
      if (!this.configuredGuildIds.has(member.guild.id) || member.user.bot) return;
      this.enqueue(member.guild.id, () => this.handleMemberAdd(member));
    });
    this.client.on(Events.InviteCreate, (invite) => {
      if (!invite.guild || !this.configuredGuildIds.has(invite.guild.id)) return;
      this.enqueue(invite.guild.id, () => this.handleInviteCreate(invite));
    });
    this.client.on(Events.InviteDelete, (invite) => {
      if (!invite.guild || !this.configuredGuildIds.has(invite.guild.id)) return;
      this.enqueue(invite.guild.id, () => this.handleInviteDelete(invite));
    });
    this.client.on(Events.Error, (error) => {
      this.setError(error);
      log("error", "discord_client_error", { message: safeMessage(error) });
    });
    this.client.on(Events.Warn, (message) => {
      log("warn", "discord_client_warning", { message: message.slice(0, 500) });
    });
  }

  private async seedConfiguredGuilds() {
    this.health.ready = false;
    this.health.lastError = null;
    for (const guildId of this.config.discordGuildIds) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        await this.assertInviteAccess(guild);
        await this.repository.assertConfiguredGuild(guild.id);
        const snapshots = await this.fetchSnapshots(guild);
        this.states.set(guild.id, {
          snapshots,
          pendingCredits: [],
          recentDeleted: [],
        });
        await this.repository.replaceSnapshots(guild.id, [...snapshots.values()]);
        log("info", "guild_invites_seeded", {
          guildId: guild.id,
          inviteCount: snapshots.size,
        });
      } catch (error) {
        this.setError(error);
        log("error", "guild_seed_failed", {
          guildId,
          message: safeMessage(error),
        });
      }
    }
    this.health.trackedGuildCount = this.states.size;
    this.health.ready = true;
    log("info", "worker_ready", {
      trackedGuildCount: this.health.trackedGuildCount,
      configuredGuildCount: this.health.configuredGuildCount,
    });
  }

  private async handleInviteCreate(invite: Invite) {
    const state = this.states.get(invite.guild?.id ?? "");
    if (!state || !invite.guild) return;
    const snapshot = snapshotFromInvite(invite);
    state.snapshots.set(snapshot.code, snapshot);
    state.recentDeleted = state.recentDeleted.filter((entry) => entry.code !== snapshot.code);
    await this.repository.upsertSnapshot(invite.guild.id, snapshot);
    this.clearError();
    log("info", "invite_created", { guildId: invite.guild.id, code: snapshot.code });
  }

  private async handleInviteDelete(invite: Invite) {
    const state = this.states.get(invite.guild?.id ?? "");
    if (!state || !invite.guild) return;
    const previous = state.snapshots.get(invite.code) ?? snapshotFromInvite(invite);
    state.snapshots.delete(invite.code);
    state.recentDeleted = [
      ...state.recentDeleted.filter((entry) => entry.code !== invite.code),
      { ...previous, deletedAt: Date.now() },
    ].slice(-20);
    await this.repository.markSnapshotDeleted(invite.guild.id, invite.code);
    this.clearError();
    log("info", "invite_deleted", { guildId: invite.guild.id, code: invite.code });
  }

  private async handleMemberAdd(member: GuildMember) {
    const state = this.states.get(member.guild.id);
    if (!state) {
      throw new Error(`Servidor ${member.guild.id} ainda não possui baseline de convites.`);
    }

    const now = Date.now();
    const current = await this.fetchSnapshots(member.guild);
    state.pendingCredits = discardExpiredCredits(state.pendingCredits, now);
    state.recentDeleted = state.recentDeleted.filter(
      (invite) => now - invite.deletedAt <= 5_000,
    );
    const detected = creditsFromInviteChanges({
      previous: state.snapshots,
      current,
      recentDeleted: state.recentDeleted,
      now,
    });
    state.pendingCredits.push(...detected.credits);
    if (detected.consumedDeletedCode) {
      state.recentDeleted = state.recentDeleted.filter(
        (invite) => invite.code !== detected.consumedDeletedCode,
      );
    }
    state.snapshots = current;
    await this.repository.replaceSnapshots(member.guild.id, [...current.values()]);

    const credit = state.pendingCredits.shift();
    const result = await this.repository.recordJoin({
      discordGuildId: member.guild.id,
      inviteeDiscordUserId: member.id,
      inviteeDisplayName: member.displayName.slice(0, 100),
      inviteeAvatarUrl: member.user.displayAvatarURL({ extension: "png", size: 128 }),
      inviteeAccountCreatedAt: new Date(member.user.createdTimestamp).toISOString(),
      joinedAt: new Date(member.joinedTimestamp ?? now).toISOString(),
      inviteeIsPending: member.pending,
      attributionStatus: credit?.status ?? "unattributed",
      inviteCode: credit?.code ?? null,
      inviterDiscordUserId: credit?.inviterId ?? null,
      details: credit
        ? {
            detection_source: credit.source,
            queued_credits_after: state.pendingCredits.length,
          }
        : {
            reason: "no_unique_invite_delta",
            queued_credits_after: state.pendingCredits.length,
          },
    });
    this.health.lastEventAt = new Date().toISOString();
    this.clearError();
    log("info", "member_join_recorded", {
      guildId: member.guild.id,
      inviteeId: member.id,
      status: result.eventStatus,
      affectedGiveawayCount: result.affectedGiveawayCount,
      wasCreated: result.wasCreated,
    });
  }

  private async assertInviteAccess(guild: Guild) {
    const botMember = guild.members.me ?? await guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionFlagsBits.ManageGuild)) {
      throw new Error(
        `O bot precisa da permissão Gerenciar Servidor em ${guild.id} para ler usos e criadores dos convites.`,
      );
    }
  }

  private async fetchSnapshots(guild: Guild) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const invites = await guild.invites.fetch();
        return new Map(invites.map((invite) => [invite.code, snapshotFromInvite(invite)]));
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(attempt * 350);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Discord não retornou os convites do servidor.");
  }

  private enqueue(guildId: string, task: () => Promise<void>) {
    const previous = this.queues.get(guildId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch((error) => {
        this.setError(error);
        log("error", "guild_task_failed", { guildId, message: safeMessage(error) });
      })
      .finally(() => {
        if (this.queues.get(guildId) === next) this.queues.delete(guildId);
      });
    this.queues.set(guildId, next);
  }

  private setError(error: unknown) {
    this.health.lastError = safeMessage(error);
  }

  private clearError() {
    this.health.lastError = null;
  }
}

function snapshotFromInvite(invite: Invite): InviteSnapshot {
  return {
    code: invite.code,
    inviterId: invite.inviter?.id ?? null,
    channelId: invite.channel?.id ?? null,
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? null,
    createdTimestamp: invite.createdTimestamp,
    expiresTimestamp: invite.expiresTimestamp,
  };
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function log(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, string | number | boolean>,
) {
  console[level](JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  }));
}
