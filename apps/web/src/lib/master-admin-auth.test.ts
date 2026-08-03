import { describe, expect, it } from "vitest";

import {
  MASTER_ADMIN_ROOT,
  isMasterAdminPath,
  masterAdminLoginHref,
} from "./master-admin-auth";

describe("autenticação do painel mestre 101Devs", () => {
  it("reconhece somente a árvore do painel mestre", () => {
    expect(isMasterAdminPath(MASTER_ADMIN_ROOT)).toBe(true);
    expect(isMasterAdminPath(`${MASTER_ADMIN_ROOT}?periodo=atual`)).toBe(true);
    expect(isMasterAdminPath(`${MASTER_ADMIN_ROOT}/login`)).toBe(true);
    expect(isMasterAdminPath("/admin/discordbots-clientes")).toBe(false);
    expect(isMasterAdminPath("/dashboard")).toBe(false);
  });

  it("mantém o destino no login exclusivo da 101Devs", () => {
    expect(masterAdminLoginHref(`${MASTER_ADMIN_ROOT}?periodo=atual`)).toBe(
      "/admin/discordbots/login?next=%2Fadmin%2Fdiscordbots%3Fperiodo%3Datual",
    );
  });
});
