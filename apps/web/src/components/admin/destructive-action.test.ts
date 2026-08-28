import { describe, expect, it, vi } from "vitest";

import { runDestructiveAction } from "./destructive-action";

describe("ação destrutiva", () => {
  it("devolve o resultado quando a action responde", async () => {
    const state = { ok: true, message: "Produto excluído definitivamente." };
    await expect(runDestructiveAction(async () => state)).resolves.toBe(state);
  });

  it("uma action que estoura vira mensagem, não silêncio", async () => {
    // Sem isto o diálogo ficava aberto, o spinner sumia e nada era escrito: o
    // operador via o botão simplesmente não fazer nada, que foi como o bug
    // chegou — "o botão de excluir não está funcionando".
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runDestructiveAction(async () => {
      throw new Error("Failed to fetch");
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("não chegou ao servidor");
    expect(result.message).toContain("nada foi alterado");
  });
});
