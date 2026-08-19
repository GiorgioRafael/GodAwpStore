import { describe, expect, it } from "vitest";

import {
  MASTER_ADMIN_LEGACY_ROOT,
  MASTER_ADMIN_ROOT,
  isMasterAdminPath,
  masterAdminLoginHref,
} from "./master-admin-auth";

describe("autenticação do painel mestre 101Devs", () => {
  it("reconhece toda a árvore do painel mestre", () => {
    expect(isMasterAdminPath(MASTER_ADMIN_ROOT)).toBe(true);
    expect(isMasterAdminPath(`${MASTER_ADMIN_ROOT}?periodo=atual`)).toBe(true);
    expect(isMasterAdminPath(`${MASTER_ADMIN_ROOT}/sobremesas-fit`)).toBe(true);
    // Uma aba nova nasce protegida: qualquer caminho debaixo de /admin exige a
    // sessão Google, mesmo que ninguém tenha lembrado de cadastrá-la.
    expect(isMasterAdminPath(`${MASTER_ADMIN_ROOT}/aba-que-ainda-nao-existe`)).toBe(true);
    expect(isMasterAdminPath(MASTER_ADMIN_LEGACY_ROOT)).toBe(true);
    expect(isMasterAdminPath(`${MASTER_ADMIN_LEGACY_ROOT}/login`)).toBe(true);
  });

  it("não confunde caminhos vizinhos com o painel", () => {
    expect(isMasterAdminPath("/administracao")).toBe(false);
    expect(isMasterAdminPath("/admin-clientes")).toBe(false);
    expect(isMasterAdminPath("/dashboard")).toBe(false);
  });

  it("mantém o destino no login exclusivo da 101Devs", () => {
    expect(masterAdminLoginHref(`${MASTER_ADMIN_ROOT}?periodo=atual`)).toBe(
      "/admin/discordbots/login?next=%2Fadmin%3Fperiodo%3Datual",
    );
  });
});
