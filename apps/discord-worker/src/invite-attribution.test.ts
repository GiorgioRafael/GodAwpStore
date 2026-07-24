import { describe, expect, it } from "vitest";

import {
  creditsFromInviteChanges,
  discardExpiredCredits,
  type InviteSnapshot,
} from "./invite-attribution.js";

function invite(
  code: string,
  uses: number,
  inviterId: string | null = "123456789012345678",
  maxUses: number | null = 0,
): InviteSnapshot {
  return {
    code,
    uses,
    inviterId,
    maxUses,
    channelId: "223456789012345678",
    createdTimestamp: 1,
    expiresTimestamp: null,
  };
}

describe("creditsFromInviteChanges", () => {
  it("atribui todos os incrementos quando somente um convite mudou", () => {
    const result = creditsFromInviteChanges({
      previous: new Map([["abc", invite("abc", 3)]]),
      current: new Map([["abc", invite("abc", 5)]]),
      recentDeleted: [],
      now: 10_000,
    });

    expect(result.credits).toHaveLength(2);
    expect(result.credits).toEqual([
      expect.objectContaining({
        status: "attributed",
        code: "abc",
        inviterId: "123456789012345678",
      }),
      expect.objectContaining({
        status: "attributed",
        code: "abc",
        inviterId: "123456789012345678",
      }),
    ]);
  });

  it("marca como ambíguo quando convites distintos mudam juntos", () => {
    const result = creditsFromInviteChanges({
      previous: new Map([
        ["abc", invite("abc", 1)],
        ["def", invite("def", 7, "323456789012345678")],
      ]),
      current: new Map([
        ["abc", invite("abc", 2)],
        ["def", invite("def", 8, "323456789012345678")],
      ]),
      recentDeleted: [],
      now: 10_000,
    });

    expect(result.credits).toEqual([
      expect.objectContaining({ status: "ambiguous", code: null, inviterId: null }),
      expect.objectContaining({ status: "ambiguous", code: null, inviterId: null }),
    ]);
  });

  it("não atribui convite sem criador conhecido", () => {
    const result = creditsFromInviteChanges({
      previous: new Map([["abc", invite("abc", 0, null)]]),
      current: new Map([["abc", invite("abc", 1, null)]]),
      recentDeleted: [],
      now: 10_000,
    });

    expect(result.credits[0]).toEqual(expect.objectContaining({
      status: "unattributed",
      code: "abc",
      inviterId: null,
    }));
  });

  it("correlaciona um convite de uso único recém-excluído", () => {
    const result = creditsFromInviteChanges({
      previous: new Map(),
      current: new Map(),
      recentDeleted: [{
        ...invite("once", 0, "123456789012345678", 1),
        deletedAt: 9_000,
      }],
      now: 10_000,
    });

    expect(result.consumedDeletedCode).toBe("once");
    expect(result.credits[0]).toEqual(expect.objectContaining({
      status: "attributed",
      code: "once",
      source: "one_use_deleted",
    }));
  });

  it("não adivinha entre dois convites de uso único excluídos", () => {
    const result = creditsFromInviteChanges({
      previous: new Map(),
      current: new Map(),
      recentDeleted: [
        { ...invite("one", 0, "123456789012345678", 1), deletedAt: 9_000 },
        { ...invite("two", 0, "323456789012345678", 1), deletedAt: 9_500 },
      ],
      now: 10_000,
    });

    expect(result.credits).toEqual([]);
  });
});

describe("discardExpiredCredits", () => {
  it("remove créditos antigos antes de correlacionar novos membros", () => {
    expect(discardExpiredCredits([
      {
        status: "attributed",
        code: "old",
        inviterId: "123456789012345678",
        source: "usage_delta",
        detectedAt: 1_000,
      },
      {
        status: "ambiguous",
        code: null,
        inviterId: null,
        source: "usage_delta",
        detectedAt: 40_000,
      },
    ], 50_000)).toHaveLength(1);
  });
});
