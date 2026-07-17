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
          label: "Customização do bot",
          href: "/customizacao-bot",
        }),
      ]),
    );
  });

  it("marca a rota e suas páginas filhas como ativas", () => {
    expect(isNavigationItemActive("/customizacao-bot", "/customizacao-bot")).toBe(true);
    expect(isNavigationItemActive("/customizacao-bot/preview", "/customizacao-bot")).toBe(true);
    expect(getCurrentPageLabel("/customizacao-bot")).toBe("Customização do bot");
  });
});
