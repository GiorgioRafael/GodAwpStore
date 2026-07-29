import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, update, maybeSingle, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  return { requireAdmin: vi.fn(), update, eq, maybeSingle, from: vi.fn(() => ({ update })) };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({ from })),
}));

import { saveRouletteRatesAction } from "./roulette-metrics";

const EMPTY = { ok: false, message: "" };

function form(markup: string, fee: string, sale = "50") {
  const data = new FormData();
  data.set("markupPercent", markup);
  data.set("feePercent", fee);
  data.set("salePercent", sale);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ authUserId: "u1", discordId: "1" });
  maybeSingle.mockResolvedValue({ data: { id: 1 }, error: null });
});

describe("premissas da roleta", () => {
  it("grava as duas taxas em pontos-base", async () => {
    const result = await saveRouletteRatesAction(EMPTY, form("150", "5"));

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({
      roulette_markup_bps: 15_000,
      livepix_fee_bps: 500,
      roulette_sale_rate_bps: 5_000,
    });
  });

  it("aceita vírgula, que é como se escreve porcentagem em português", async () => {
    await saveRouletteRatesAction(EMPTY, form("70,5", "4,99"));

    expect(update).toHaveBeenCalledWith({
      roulette_markup_bps: 7_050,
      livepix_fee_bps: 499,
      roulette_sale_rate_bps: 5_000,
    });
  });

  it("recusa valores fora da faixa sem tocar no banco", async () => {
    // Uma taxa de 50% não existe em provedor nenhum, e um markup de 20.000%
    // faria o painel reportar lucro que não existe.
    for (const [markup, fee, sale] of [
      ["70", "50", "50"],
      ["20000", "5", "50"],
      ["-1", "5", "50"],
      ["", "5", "50"],
      ["abc", "5", "50"],
      // A recompra passa a ser editável, mas não pode devolver mais que o item.
      ["70", "5", "120"],
      ["70", "5", "abc"],
    ]) {
      const result = await saveRouletteRatesAction(EMPTY, form(markup, fee, sale));
      expect(result.ok).toBe(false);
    }

    expect(update).not.toHaveBeenCalled();
  });

  it("não deixa passar sem sessão de administrador", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));

    const result = await saveRouletteRatesAction(EMPTY, form("70", "5"));

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
