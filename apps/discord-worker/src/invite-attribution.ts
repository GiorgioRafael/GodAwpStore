export type InviteSnapshot = {
  code: string;
  inviterId: string | null;
  channelId: string | null;
  uses: number;
  maxUses: number | null;
  createdTimestamp: number | null;
  expiresTimestamp: number | null;
};

export type RecentDeletedInvite = InviteSnapshot & {
  deletedAt: number;
};

export type InviteCredit = {
  status: "attributed" | "ambiguous" | "unattributed";
  code: string | null;
  inviterId: string | null;
  source: "usage_delta" | "one_use_deleted";
  detectedAt: number;
};

const DELETED_INVITE_WINDOW_MS = 5_000;
const MAX_CREDITS_PER_FETCH = 100;

export function creditsFromInviteChanges(input: {
  previous: ReadonlyMap<string, InviteSnapshot>;
  current: ReadonlyMap<string, InviteSnapshot>;
  recentDeleted: readonly RecentDeletedInvite[];
  now: number;
}): { credits: InviteCredit[]; consumedDeletedCode: string | null } {
  const changed: Array<{ snapshot: InviteSnapshot; delta: number }> = [];
  for (const snapshot of input.current.values()) {
    const previousUses = input.previous.get(snapshot.code)?.uses ?? snapshot.uses;
    const delta = Math.max(snapshot.uses - previousUses, 0);
    if (delta > 0) changed.push({ snapshot, delta });
  }

  if (changed.length === 1) {
    const [{ snapshot, delta }] = changed;
    return {
      credits: Array.from({ length: Math.min(delta, MAX_CREDITS_PER_FETCH) }, () => ({
        status: snapshot.inviterId ? "attributed" as const : "unattributed" as const,
        code: snapshot.code,
        inviterId: snapshot.inviterId,
        source: "usage_delta" as const,
        detectedAt: input.now,
      })),
      consumedDeletedCode: null,
    };
  }

  if (changed.length > 1) {
    const totalDelta = Math.min(
      changed.reduce((sum, value) => sum + value.delta, 0),
      MAX_CREDITS_PER_FETCH,
    );
    return {
      credits: Array.from({ length: totalDelta }, () => ({
        status: "ambiguous" as const,
        code: null,
        inviterId: null,
        source: "usage_delta" as const,
        detectedAt: input.now,
      })),
      consumedDeletedCode: null,
    };
  }

  const deletedCandidates = input.recentDeleted.filter((invite) =>
    input.now - invite.deletedAt <= DELETED_INVITE_WINDOW_MS
    && invite.maxUses !== null
    && invite.maxUses > 0
    && invite.uses + 1 >= invite.maxUses
  );
  if (deletedCandidates.length !== 1) {
    return { credits: [], consumedDeletedCode: null };
  }

  const [invite] = deletedCandidates;
  return {
    credits: [{
      status: invite.inviterId ? "attributed" : "unattributed",
      code: invite.code,
      inviterId: invite.inviterId,
      source: "one_use_deleted",
      detectedAt: input.now,
    }],
    consumedDeletedCode: invite.code,
  };
}

export function discardExpiredCredits(
  credits: readonly InviteCredit[],
  now: number,
  maximumAgeMs = 30_000,
) {
  return credits.filter((credit) => now - credit.detectedAt <= maximumAgeMs);
}
