import { describe, expect, it } from "vitest";

import { slugFromName, uniqueSlug } from "./slug";

describe("slugFromName", () => {
  it("gera um slug minúsculo sem acentos a partir do nome", () => {
    expect(slugFromName("  Poção D'Água Suprema  ")).toBe("pocao-dagua-suprema");
  });

  it("usa um valor seguro quando o nome não contém letras ou números", () => {
    expect(slugFromName("🔥✨")).toBe("produto");
  });

  it("limita o slug sem deixar hífen no final", () => {
    expect(slugFromName("Produto muito especial", 14)).toBe("produto-muito");
  });
});

describe("uniqueSlug", () => {
  it("mantém o slug quando ele está disponível", () => {
    expect(uniqueSlug("awp-asiimov", ["ak-47-redline"])).toBe("awp-asiimov");
  });

  it("adiciona a próxima sequência disponível", () => {
    expect(uniqueSlug("awp-asiimov", ["AWP-ASIIMOV", "awp-asiimov-2"])).toBe(
      "awp-asiimov-3",
    );
  });

  it("reserva espaço para o sufixo dentro do limite", () => {
    expect(uniqueSlug("produto-muito", ["produto-muito"], 14)).toBe("produto-muit-2");
  });
});
