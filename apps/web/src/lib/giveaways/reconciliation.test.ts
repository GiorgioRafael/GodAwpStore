import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateReferralMembership } from "./reconciliation";

const recordedJoin = "2026-07-20T12:00:00.000Z";
const afterTwoHours = Date.parse("2026-07-20T14:00:00.000Z");

describe("giveaway referral membership rules", () => {
  it("valida quem permaneceu no servidor pelo tempo mínimo", () => {
    expect(evaluateReferralMembership(
      recordedJoin,
      { exists: true, pending: false, joinedAt: recordedJoin },
      60,
      afterTwoHours,
      true,
    )).toEqual({ status: "valid", reason: null });
  });

  it("invalida saída e reentrada mesmo que a pessoa esteja no servidor no encerramento", () => {
    const decision = evaluateReferralMembership(
      recordedJoin,
      { exists: true, pending: false, joinedAt: "2026-07-20T13:00:00.000Z" },
      30,
      afterTwoHours,
      true,
    );

    expect(decision.status).toBe("invalid");
    expect(decision.reason).toContain("entrou novamente");
  });

  it("mantém pendente durante o período e invalida no encerramento sem permanência mínima", () => {
    const membership = {
      exists: true,
      pending: false,
      joinedAt: "2026-07-20T13:45:00.000Z",
    };

    expect(evaluateReferralMembership(
      membership.joinedAt,
      membership,
      60,
      afterTwoHours,
      false,
    ).status).toBe("pending");
    expect(evaluateReferralMembership(
      membership.joinedAt,
      membership,
      60,
      afterTwoHours,
      true,
    ).status).toBe("invalid");
  });

  it("invalida quem saiu ou não concluiu a verificação", () => {
    expect(evaluateReferralMembership(
      recordedJoin,
      { exists: false, pending: false, joinedAt: null },
      0,
      afterTwoHours,
      true,
    ).status).toBe("invalid");
    expect(evaluateReferralMembership(
      recordedJoin,
      { exists: true, pending: true, joinedAt: recordedJoin },
      0,
      afterTwoHours,
      true,
    ).status).toBe("invalid");
  });
});
