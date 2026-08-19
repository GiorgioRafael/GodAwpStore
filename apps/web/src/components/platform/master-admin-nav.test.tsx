import { describe, expect, it } from "vitest";

import { activeMasterAdminTabId } from "./master-admin-nav";

describe("aba ativa do painel mestre", () => {
  it("marca a visão geral em /admin e na URL antiga", () => {
    expect(activeMasterAdminTabId("/admin")).toBe("visao-geral");
    expect(activeMasterAdminTabId("/admin/discordbots")).toBe("visao-geral");
  });

  it("marca a aba do produto pela própria rota", () => {
    expect(activeMasterAdminTabId("/admin/gwstore")).toBe("gwstore");
    expect(activeMasterAdminTabId("/admin/loja-th")).toBe("loja-th");
    expect(activeMasterAdminTabId("/admin/sobremesas-fit")).toBe("sobremesas-fit");
  });

  it("mantém a aba marcada em uma sub-rota dela", () => {
    expect(activeMasterAdminTabId("/admin/sobremesas-fit/detalhe")).toBe("sobremesas-fit");
  });

  it("não deixa um prefixo parecido roubar o destaque", () => {
    expect(activeMasterAdminTabId("/admin/gwstore-antiga")).toBe("visao-geral");
  });
});
