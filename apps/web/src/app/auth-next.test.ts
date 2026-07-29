import { describe, expect, it } from "vitest";

import { safeInternalPath } from "@/lib/safe-redirect";

describe("destino depois do login com Discord", () => {
  const site = "https://gwstore.vercel.app";

  it("o fallback é do painel, então perder o next joga o jogador no painel", () => {
    // É a razão de o destino viajar também num cookie: sem next, o callback
    // manda para /dashboard, o proxy vê um não-admin e responde acesso negado —
    // um login que funcionou, relatado como recusado.
    expect(safeInternalPath(null, site)).toBe("/dashboard");
  });

  it("preserva a roleta quando o next chega", () => {
    expect(safeInternalPath("/roleta", site)).toBe("/roleta");
    expect(safeInternalPath("/roleta?compra=1", site)).toBe("/roleta?compra=1");
  });

  it("recusa destino externo, mesmo vindo do cookie", () => {
    // O cookie é entrada como qualquer outra: passa pela mesma validação.
    expect(safeInternalPath("https://evil.example/roleta", site)).toBe("/dashboard");
    // Protocolo-relativo também sai do site, e também é recusado.
    expect(safeInternalPath("//evil.example", site)).toBe("/dashboard");
    expect(safeInternalPath("/\\evil.example", site)).toBe("/dashboard");
  });
});
