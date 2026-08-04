import { describe, expect, it } from "vitest";

import {
  calculateRevenueChange,
  calculateCommissionFromGross,
  formatDashboardMonth,
  getBotHealth,
} from "./discord-bots-dashboard";

describe("Discord bots master dashboard", () => {
  it("marks a recently seen active bot as online", () => {
    const now = Date.parse("2026-08-03T15:00:00.000Z");
    expect(getBotHealth("active", "2026-08-03T14:50:00.000Z", now)).toEqual({
      label: "Online",
      tone: "success",
    });
  });

  it("does not call an active bot offline just because it is idle", () => {
    expect(getBotHealth("active", null)).toEqual({ label: "Ativo", tone: "neutral" });
  });

  it("keeps disconnected and suspended states explicit", () => {
    expect(getBotHealth("left", null).label).toBe("Desconectado");
    expect(getBotHealth("suspended", null).label).toBe("Suspenso");
  });

  it("formats chart months in Portuguese without a trailing dot", () => {
    expect(formatDashboardMonth("2026-08-01")).toBe("Ago");
  });

  it("calculates month-over-month revenue and avoids division by zero", () => {
    expect(calculateRevenueChange(12_000, 10_000)).toBe(20);
    expect(calculateRevenueChange(12_000, 0)).toBeNull();
  });

  it("calcula a comissão configurada sobre o faturamento bruto", () => {
    expect(calculateCommissionFromGross(34_180, 200)).toBe(684);
    expect(calculateCommissionFromGross(0, 200)).toBe(0);
  });
});
