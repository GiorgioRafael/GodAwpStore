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

  it("mantém as páginas da roleta juntas no grupo de gestão", () => {
    // A roleta só existe na GWStore, que é a loja padrão em teste.
    const management = navigationGroups.find((group) => group.label === "Gestão");
    const hrefs = management?.items.map((item) => item.href) ?? [];

    expect(hrefs).toContain("/admin/resgates");
    expect(hrefs).toContain("/admin/metricas-roleta");
    expect(hrefs.indexOf("/admin/metricas-roleta")).toBe(hrefs.indexOf("/admin/resgates") + 1);
    expect(getCurrentPageLabel("/metricas-roleta")).toBe("Roleta");
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
    expect(filterNavigationGroups("operacao pedidos").flatMap((group) => group.items).map((item) => item.href)).toEqual(["/admin/pedidos"]);
    expect(filterNavigationGroups("configuracoes").flatMap((group) => group.items).map((item) => item.href)).toEqual(["/admin/configuracoes"]);
    expect(filterNavigationGroups("área inexistente")).toEqual([]);
    expect(filterNavigationGroups(" ")).toEqual(navigationGroups);
  });

  it("marca somente a visão geral em /admin e reconhece a navegação com prefixo", () => {
    expect(isNavigationItemActive("/admin", "/admin")).toBe(true);
    expect(isNavigationItemActive("/admin/pedidos", "/admin")).toBe(false);
    expect(getCurrentPageLabel("/admin/pedidos")).toBe("Pedidos");
    expect(getCurrentPageLabel("/admin/configuracoes", "#vitrines")).toBe("Vitrines do Discord");
  });
});
