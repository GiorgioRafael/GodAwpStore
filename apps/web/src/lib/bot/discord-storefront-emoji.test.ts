import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { stripOptionEmojis } from "./discord-storefront";

describe("vitrine sem os ícones", () => {
  it("tira todo emoji, em qualquer profundidade", () => {
    const payload = {
      flags: 32768,
      components: [
        { type: 1, components: [{ type: 3, options: [
          { label: "Semente", value: "a", emoji: { id: "1", name: "s" } },
          { label: "Regador", value: "b", emoji: { id: "2", name: "r" } },
        ] }] },
      ],
    };
    const limpo = stripOptionEmojis(payload) as typeof payload;
    expect(JSON.stringify(limpo)).not.toContain("emoji");
    // O resto do payload continua intacto: é a mesma vitrine, sem enfeite.
    expect(limpo.flags).toBe(32768);
    expect(limpo.components[0].components[0].options.map((o) => o.label)).toEqual([
      "Semente",
      "Regador",
    ]);
  });

  it("devolve null quando não havia emoji nenhum", () => {
    // Importa: sem emoji para tirar, o 400 tem outra causa e repetir a mesma
    // chamada só gastaria a segunda tentativa escondendo o erro real.
    expect(stripOptionEmojis({ content: "oi", components: [] })).toBeNull();
  });
});
