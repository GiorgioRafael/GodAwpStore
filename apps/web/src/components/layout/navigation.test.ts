import { describe, expect, it } from "vitest";

import {
  getCurrentPageLabel,
  filterNavigationGroups,
  isNavigationItemActive,
  navigationGroups,
} from "./navigation";

describe("navegação da customização do bot", () => {
  it("expõe a nova página no grupo de gestão", () => {
    const management = navigationGroups.find((group) => group.label === "Gestão");
    expect(management?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Sorteios",
          href: "/admin/sorteios",
        }),
        expect.objectContaining({
          label: "Customização do bot",
          href: "/admin/customizacao-bot",
        }),
      ]),
    );
  });

  it("não oferece páginas da roleta na GWStore", () => {
    const management = navigationGroups.find((group) => group.label === "Gestão");
    const hrefs = management?.items.map((item) => item.href) ?? [];

    expect(hrefs).not.toContain("/admin/resgates");
    expect(hrefs).not.toContain("/admin/metricas-roleta");
    expect(filterNavigationGroups("roleta")).toEqual([]);
  });

  it("marca a rota e suas páginas filhas como ativas", () => {
    expect(isNavigationItemActive("/customizacao-bot", "/customizacao-bot")).toBe(true);
    expect(isNavigationItemActive("/customizacao-bot/preview", "/customizacao-bot")).toBe(true);
    expect(getCurrentPageLabel("/customizacao-bot")).toBe("Customização do bot");
  });

  it("distingue vitrines de configurações e evita marcar rotas de nome parecido", () => {
    expect(isNavigationItemActive("/configuracoes", "/configuracoes#vitrines", "#vitrines")).toBe(true);
    expect(isNavigationItemActive("/configuracoes", "/configuracoes", "#vitrines")).toBe(false);
    expect(getCurrentPageLabel("/configuracoes", "#vitrines")).toBe("Vitrines do Discord");
    expect(getCurrentPageLabel("/configuracoes")).toBe("Configurações");
    expect(isNavigationItemActive("/pedidos-antigos", "/pedidos")).toBe(false);
  });

  it("encontra áreas por nome ou grupo sem depender de acentos", () => {
    expect(filterNavigationGroups("operacao pedidos").flatMap((group) => group.items).map((item) => item.href)).toEqual(["/admin/pedidos", "/admin/atendimento-loja"]);
    expect(filterNavigationGroups("configuracoes").flatMap((group) => group.items).map((item) => item.href)).toEqual(["/admin/configuracoes"]);
    expect(filterNavigationGroups("área inexistente")).toEqual([]);
    expect(filterNavigationGroups(" ")).toEqual(navigationGroups);
  });

  it("marca somente a visão geral em /admin e reconhece a navegação com prefixo", () => {
    expect(isNavigationItemActive("/admin", "/admin")).toBe(true);
    expect(isNavigationItemActive("/admin/pedidos", "/admin")).toBe(false);
    expect(getCurrentPageLabel("/admin/pedidos")).toBe("Pedidos");
    expect(getCurrentPageLabel("/admin/configuracoes", "#vitrines")).toBe("Vitrines do Discord");
    expect(getCurrentPageLabel("/admin/atendimento-loja/10000000-0000-4000-8000-000000000001")).toBe("Pedidos da loja");
  });
});
