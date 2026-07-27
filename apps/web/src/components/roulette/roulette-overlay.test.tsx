import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Faithful stand-in for the server action: it keeps a log and filters strictly
// after the cursor, so a client that fails to advance the cursor loses events
// exactly like production did.
const feed = vi.hoisted(() => ({
  log: [] as Array<Record<string, unknown> & { createdAt: string }>,
  clock: 0,
}));

function stamp(tick: number) {
  return `2026-07-27T00:00:${String(tick).padStart(2, "0")}.000Z`;
}

vi.mock("@/app/roleta/overlay/actions", () => ({
  readRouletteOverlayEvents: vi.fn(async (_token: string, sinceIso: string | null) => {
    // A cold overlay starts from now instead of replaying the backlog.
    const since = sinceIso ?? stamp(feed.clock);
    const events = feed.log.filter((event) => event.createdAt > since);
    return {
      events,
      cursor: events.length ? events[events.length - 1].createdAt : since,
    };
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
};

function emit(...events: FeedEvent[]) {
  for (const event of events) {
    feed.clock += 1;
    feed.log.push({ ...event, createdAt: stamp(feed.clock) });
  }
}

function spinEvent(id: string, overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id,
    prizeKey: "premio_1",
    productName: "Rainbow Seed",
    valueCents: 3,
    maskedDisplayName: "Joa...",
    isTopPrize: false,
    ...overrides,
  };
}

function mount(queueLimit: number) {
  return render(
    <RouletteOverlay
      prizes={prizes}
      token="teste"
      queueLimit={queueLimit}
      spinMs={10}
      resultMs={200}
      pollMs={20}
    />,
  );
}

/** The overlay only reacts to spins that land after it connected. */
async function waitForConnection() {
  await waitFor(() => {
    expect(screen.getByTestId("overlay-status")).toHaveAttribute("aria-label", "Conectado");
  });
}

type AnimateCall = { keyframes: Array<{ transform: string }>; options: KeyframeAnimationOptions };
const animateCalls: AnimateCall[] = [];

/** jsdom não implementa a Web Animations API; aqui ela é observável. */
function installAnimateSpy() {
  animateCalls.length = 0;
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: function animate(
      keyframes: Array<{ transform: string }>,
      options: KeyframeAnimationOptions,
    ) {
      animateCalls.push({ keyframes, options });
      return { finished: Promise.resolve(), cancel: () => undefined };
    },
  });
}

describe("RouletteOverlay", () => {
  beforeEach(() => {
    feed.log = [];
    feed.clock = 0;
    vi.useRealTimers();
    installAnimateSpy();
  });

  it("mostra o nome mascarado e o prêmio de um giro", async () => {
    mount(4);
    await waitForConnection();

    emit(spinEvent("1"));

    await waitFor(() => {
      const result = screen.getByTestId("overlay-result");
      expect(result).toHaveTextContent("Joa...");
      expect(result).toHaveTextContent("Rainbow Seed");
    });
  });

  it("reserva a área do ganhador para a roda não subir e descer", async () => {
    const { container } = mount(4);
    await waitForConnection();

    // A faixa do resultado existe mesmo sem prêmio: sem ela, o card entrando
    // recentraliza a coluna e a roda pula de lugar.
    const slot = container.querySelector('[aria-live="polite"]');
    expect(slot).not.toBeNull();
    expect(slot!.className).toContain("h-[26vh]");
    expect(screen.queryByTestId("overlay-result")).not.toBeInTheDocument();
  });

  it("apaga o card do ganhador antes de removê-lo", async () => {
    mount(4);
    await waitForConnection();

    emit(spinEvent("saida"));

    const card = await screen.findByTestId("overlay-result");
    await waitFor(() => {
      expect(card.className).toContain("opacity-100");
    });

    // Ao encerrar, ele fica montado com opacidade zero antes de sair.
    await waitFor(() => {
      expect(screen.getByTestId("overlay-result").className).toContain("opacity-0");
    });
  });

  it("gira a roda de verdade em vez de saltar para o prêmio", async () => {
    mount(4);
    await waitForConnection();

    emit(spinEvent("gira"));

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toBeInTheDocument();
    });

    // O giro precisa de uma animação própria, com começo e fim distintos: uma
    // transição CSS não roda porque o React entrega os dois estados no mesmo
    // commit, e a roda saltava direto para o prêmio.
    const spin = animateCalls.find((call) => call.options.duration === 10);
    expect(spin).toBeDefined();
    expect(spin!.keyframes).toHaveLength(2);
    expect(spin!.keyframes[0].transform).not.toBe(spin!.keyframes[1].transform);

    const from = Number(spin!.keyframes[0].transform.match(/-?[\d.]+/)![0]);
    const to = Number(spin!.keyframes[1].transform.match(/-?[\d.]+/)![0]);
    // Muitas voltas antes de parar, não um ajuste de alguns graus.
    expect(to - from).toBeGreaterThan(360 * 5);
  });

  it("pega o giro que chega entre dois polls", async () => {
    // O primeiro poll volta vazio e o giro só existe depois dele. Sem o cursor
    // do servidor avançando, este evento se perde para sempre.
    mount(4);
    await waitForConnection();

    emit(spinEvent("atrasado", { maskedDisplayName: "Ped..." }));

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toHaveTextContent("Ped...");
    });
  });

  it("conta os giros acima do limite da fila em vez de animar todos", async () => {
    mount(2);
    await waitForConnection();

    for (let index = 0; index < 8; index += 1) emit(spinEvent(`fila-${index}`));

    await waitFor(() => {
      expect(screen.getByTestId("overlay-skipped")).toBeInTheDocument();
    });
    expect(screen.getByTestId("overlay-skipped")).toHaveTextContent("giros na fila");
  });

  it("deixa o prêmio máximo furar o limite da fila", async () => {
    mount(1);
    await waitForConnection();

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

    await waitFor(() => {
      const result = screen.getByTestId("overlay-result");
      expect(result).toHaveTextContent("Prêmio máximo");
      expect(result).toHaveTextContent("Mar...");
      expect(result).toHaveTextContent("X30000 Bamboo");
    });
  });

  it("não anima duas vezes o mesmo giro reentregue", async () => {
    mount(5);
    await waitForConnection();

    // O mesmo id chega em duas rodadas diferentes do polling.
    emit(spinEvent("repetido"));
    feed.clock += 1;
    feed.log.push({ ...spinEvent("repetido"), createdAt: stamp(feed.clock) });

    await waitFor(() => {
      expect(screen.getByTestId("overlay-result")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("overlay-skipped")).not.toBeInTheDocument();
  });
});
