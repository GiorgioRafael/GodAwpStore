import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const feed = vi.hoisted(() => ({ pending: [] as unknown[] }));

vi.mock("@/app/roleta/overlay/actions", () => ({
  readRouletteOverlayEvents: vi.fn(async () => {
    const batch = feed.pending;
    feed.pending = [];
    return batch;
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

type FeedEvent = {
  id: string;
  prizeKey: string;
  productName: string;
  valueCents: number;
  maskedDisplayName: string;
  isTopPrize: boolean;
  createdAt: string;
};

function emit(...events: FeedEvent[]) {
  feed.pending.push(...events);
}

function spinEvent(id: string, overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id,
    prizeKey: "premio_1",
    productName: "Rainbow Seed",
    valueCents: 3,
    maskedDisplayName: "Joa...",
    isTopPrize: false,
    createdAt: `2026-07-27T00:00:${String(feed.pending.length).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

describe("RouletteOverlay", () => {
  beforeEach(() => {
    feed.pending = [];
    vi.useRealTimers();
  });

  it("mostra o nome mascarado e o prêmio de um giro", async () => {
    emit(spinEvent("1"));
    render(<RouletteOverlay prizes={prizes} token="teste" queueLimit={4} spinMs={10} resultMs={40} pollMs={20} />);

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toHaveTextContent("Joa...");
    });
    expect(screen.getByTestId("overlay-result")).toHaveTextContent("Rainbow Seed");
  });

  it("conta os giros acima do limite da fila em vez de animar todos", async () => {
    // O primeiro sai da fila para animar; os dois seguintes a preenchem e o
    // restante só vira contador.
    for (let index = 0; index < 8; index += 1) emit(spinEvent(`fila-${index}`));
    render(<RouletteOverlay prizes={prizes} token="teste" queueLimit={2} spinMs={10} resultMs={40} pollMs={20} />);

    await waitFor(() => {
      expect(screen.getByTestId("overlay-skipped")).toBeInTheDocument();
    });
    expect(screen.getByTestId("overlay-skipped")).toHaveTextContent("giros na fila");
  });

  it("deixa o prêmio máximo furar o limite da fila", async () => {
    for (let index = 0; index < 6; index += 1) emit(spinEvent(`comum-${index}`));
    emit(
      spinEvent("jackpot", {
        prizeKey: "premio_3",
        productName: "X30000 Bamboo",
        valueCents: 500,
        maskedDisplayName: "Mar...",
        isTopPrize: true,
      }),
    );
    render(<RouletteOverlay prizes={prizes} token="teste" queueLimit={1} spinMs={10} resultMs={40} pollMs={20} />);

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toHaveTextContent("Prêmio máximo");
    });
    expect(screen.getByTestId("overlay-result")).toHaveTextContent("Mar...");
    expect(screen.getByTestId("overlay-result")).toHaveTextContent("X30000 Bamboo");
  });

  it("ignora um evento repetido do mesmo giro", async () => {
    emit(spinEvent("repetido"));
    emit(spinEvent("repetido"));
    emit(spinEvent("repetido"));
    render(<RouletteOverlay prizes={prizes} token="teste" queueLimit={5} spinMs={10} resultMs={40} pollMs={20} />);

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("overlay-skipped")).not.toBeInTheDocument();
  });
});
