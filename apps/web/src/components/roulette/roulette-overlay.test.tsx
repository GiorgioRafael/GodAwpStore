import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  handlers: [] as Array<(payload: { new: unknown }) => void>,
  removeChannel: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    channel: () => {
      const channel = {
        on: (_event: string, _filter: unknown, handler: (p: { new: unknown }) => void) => {
          supabaseMocks.handlers.push(handler);
          return channel;
        },
        subscribe: (cb: (status: string) => void) => {
          cb("SUBSCRIBED");
          return channel;
        },
      };
      return channel;
    },
    removeChannel: supabaseMocks.removeChannel,
  }),
}));

import { RouletteOverlay } from "./roulette-overlay";
import { buildRouletteWheelPrizes } from "@/lib/roulette/demo";

const prizes = buildRouletteWheelPrizes([
  {
    prizeKey: "premio_1",
    productId: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
    name: "Rainbow Seed",
    imageUrl: null,
    valueCents: 3,
    saleValueCents: 1,
    drawChanceBps: 3258,
  },
  {
    prizeKey: "premio_3",
    productId: "1d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
    name: "X30000 Bamboo",
    imageUrl: null,
    valueCents: 500,
    saleValueCents: 250,
    drawChanceBps: 907,
  },
]);

function emit(event: {
  id: string;
  prize_key: string;
  product_name: string;
  value_cents: number;
  masked_display_name: string;
  is_top_prize: boolean;
}) {
  for (const handler of supabaseMocks.handlers) handler({ new: event });
}

function spinEvent(id: string, overrides: Partial<Parameters<typeof emit>[0]> = {}) {
  return {
    id,
    prize_key: "premio_1",
    product_name: "Rainbow Seed",
    value_cents: 3,
    masked_display_name: "Joa...",
    is_top_prize: false,
    ...overrides,
  };
}

describe("RouletteOverlay", () => {
  beforeEach(() => {
    supabaseMocks.handlers.length = 0;
    supabaseMocks.removeChannel.mockReset();
    vi.useRealTimers();
  });

  it("mostra o nome mascarado e o prêmio de um giro", async () => {
    render(<RouletteOverlay prizes={prizes} queueLimit={4} spinMs={10} resultMs={40} />);

    emit(spinEvent("1"));

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toHaveTextContent("Joa...");
    });
    expect(screen.getByTestId("overlay-result")).toHaveTextContent("Rainbow Seed");
  });

  it("conta os giros acima do limite da fila em vez de animar todos", async () => {
    render(<RouletteOverlay prizes={prizes} queueLimit={2} spinMs={10} resultMs={40} />);

    // O primeiro sai da fila para animar; os dois seguintes a preenchem e o
    // restante só vira contador.
    for (let index = 0; index < 8; index += 1) emit(spinEvent(`fila-${index}`));

    await waitFor(() => {
      expect(screen.getByTestId("overlay-skipped")).toBeInTheDocument();
    });
    expect(screen.getByTestId("overlay-skipped")).toHaveTextContent("giros na fila");
  });

  it("deixa o prêmio máximo furar o limite da fila", async () => {
    render(<RouletteOverlay prizes={prizes} queueLimit={1} spinMs={10} resultMs={40} />);

    for (let index = 0; index < 6; index += 1) emit(spinEvent(`comum-${index}`));
    emit(
      spinEvent("jackpot", {
        prize_key: "premio_3",
        product_name: "X30000 Bamboo",
        value_cents: 500,
        masked_display_name: "Mar...",
        is_top_prize: true,
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toHaveTextContent("Prêmio máximo");
    });
    expect(screen.getByTestId("overlay-result")).toHaveTextContent("Mar...");
    expect(screen.getByTestId("overlay-result")).toHaveTextContent("X30000 Bamboo");
  });

  it("ignora um evento repetido do mesmo giro", async () => {
    render(<RouletteOverlay prizes={prizes} queueLimit={5} spinMs={10} resultMs={40} />);

    emit(spinEvent("repetido"));
    emit(spinEvent("repetido"));
    emit(spinEvent("repetido"));

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("overlay-skipped")).not.toBeInTheDocument();
  });
});
