import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isValidMasterDashboardSecret } from "./master-dashboard-auth";

afterEach(() => {
  delete process.env.MASTER_DASHBOARD_SHARED_SECRET;
});

describe("autorização do resumo multi-serviço", () => {
  it("aceita somente o segredo compartilhado completo", () => {
    process.env.MASTER_DASHBOARD_SHARED_SECRET = "a".repeat(48);
    expect(isValidMasterDashboardSecret("a".repeat(48))).toBe(true);
    expect(isValidMasterDashboardSecret("a".repeat(47))).toBe(false);
    expect(isValidMasterDashboardSecret("b".repeat(48))).toBe(false);
  });

  it("falha fechado quando a configuração é curta ou ausente", () => {
    process.env.MASTER_DASHBOARD_SHARED_SECRET = "curto";
    expect(isValidMasterDashboardSecret("curto")).toBe(false);
    delete process.env.MASTER_DASHBOARD_SHARED_SECRET;
    expect(isValidMasterDashboardSecret(null)).toBe(false);
  });
});

