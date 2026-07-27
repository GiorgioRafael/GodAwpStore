import { describe, expect, it } from "vitest";

import {
  getCurrentPageLabel,
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
          href: "/sorteios",
        }),
        expect.objectContaining({
          label: "Customização do bot",
          href: "/customizacao-bot",
        }),
      ]),
    );
  });

  it("mantém as páginas da roleta juntas no grupo de gestão", () => {
    // A roleta só existe na GWStore, que é a loja padrão em teste.
    const management = navigationGroups.find((group) => group.label === "Gestão");
    const hrefs = management?.items.map((item) => item.href) ?? [];

    expect(hrefs).toContain("/resgates");
    expect(hrefs).toContain("/metricas-roleta");
    expect(hrefs.indexOf("/metricas-roleta")).toBe(hrefs.indexOf("/resgates") + 1);
    expect(getCurrentPageLabel("/metricas-roleta")).toBe("Métricas da roleta");
  });

  it("marca a rota e suas páginas filhas como ativas", () => {
    expect(isNavigationItemActive("/customizacao-bot", "/customizacao-bot")).toBe(true);
    expect(isNavigationItemActive("/customizacao-bot/preview", "/customizacao-bot")).toBe(true);
    expect(getCurrentPageLabel("/customizacao-bot")).toBe("Customização do bot");
  });
});
