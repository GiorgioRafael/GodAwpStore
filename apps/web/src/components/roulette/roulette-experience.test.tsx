import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  spinRoulette: vi.fn(),
  sellRoulettePrize: vi.fn(),
  startRouletteCoinPurchase: vi.fn(),
  getRouletteCoinPurchaseStatus: vi.fn(),
}));

vi.mock("@/app/roleta/actions", () => actionMocks);

import { RouletteExperience } from "./roulette-experience";
import { buildRouletteWheelPrizes } from "@/lib/roulette/demo";

const prizes = buildRouletteWheelPrizes([
  {
    prizeKey: "premio_2",
    productId: "0d9b5f2c-2f9c-4f2b-9a1f-6f1f0d9b5f2c",
    name: "1x Dragonfly",
    imageUrl: null,
    valueCents: 200,
    saleValueCents: 100,
    drawChanceBps: 1500,
  },
]);
const purchaseId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";

describe("RouletteExperience", () => {
  beforeEach(() => {
    actionMocks.spinRoulette.mockReset();
    actionMocks.sellRoulettePrize.mockReset();
    actionMocks.startRouletteCoinPurchase.mockReset();
    actionMocks.getRouletteCoinPurchaseStatus.mockReset();
    vi.stubGlobal("open", vi.fn());
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("bloqueia o giro sem saldo e oferece a compra de moedas", () => {
    render(
      <RouletteExperience prizes={prizes} initialInventory={[]} initialBalanceCents={0} />,
    );

    expect(screen.getByRole("button", { name: "Sem moedas suficientes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Comprar por R\$ 1,00/ })).toBeEnabled();
    expect(actionMocks.spinRoulette).not.toHaveBeenCalled();
  });

  it("gasta uma moeda por giro e atualiza o saldo", async () => {
    actionMocks.spinRoulette.mockResolvedValue({
      ok: true,
      prizeKey: "premio_2",
      inventoryQuantity: 1,
      balanceCents: 200,
      spinId: "11111111-1111-4111-8111-111111111111",
    });
    const user = userEvent.setup();

    render(
      <RouletteExperience prizes={prizes} initialInventory={[]} initialBalanceCents={300} />,
    );

    await user.click(screen.getByRole("button", { name: "Girar (1 moeda)" }));

    await waitFor(() => {
      expect(screen.getByTestId("roulette-result")).toHaveTextContent("1x Dragonfly");
    });
    expect(screen.getByText("Saldo: 2,00 moedas")).toBeInTheDocument();
    expect(actionMocks.spinRoulette).toHaveBeenCalledTimes(1);
  });

  it("avisa quando o servidor recusa o giro por falta de moedas", async () => {
    actionMocks.spinRoulette.mockResolvedValue({
      ok: false,
      message: "Moedas insuficientes. Compre moedas ou venda um item.",
    });
    const user = userEvent.setup();

    render(
      <RouletteExperience prizes={prizes} initialInventory={[]} initialBalanceCents={100} />,
    );

    await user.click(screen.getByRole("button", { name: "Girar (1 moeda)" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Moedas insuficientes");
    });
  });

  it("compra a quantidade escolhida de moedas e espera o Pix", async () => {
    actionMocks.startRouletteCoinPurchase.mockResolvedValue({
      ok: true,
      purchaseId,
      status: "awaiting_payment",
      checkoutUrl: "https://checkout.livepix.gg/abc",
      amountCents: 300,
    });
    actionMocks.getRouletteCoinPurchaseStatus.mockResolvedValue({
      ok: true,
      purchaseId,
      status: "awaiting_payment",
      balanceCents: 0,
    });
    const user = userEvent.setup();

    render(
      <RouletteExperience prizes={prizes} initialInventory={[]} initialBalanceCents={0} />,
    );

    await user.click(screen.getByRole("button", { name: "Mais uma moeda" }));
    await user.click(screen.getByRole("button", { name: "Mais uma moeda" }));
    expect(screen.getByTestId("coin-quantity")).toHaveTextContent("3");

    await user.click(screen.getByRole("button", { name: /Comprar por R\$ 3,00/ }));

    await waitFor(() => {
      expect(screen.getByText("Aguardando a confirmação do Pix")).toBeInTheDocument();
    });
    expect(actionMocks.startRouletteCoinPurchase).toHaveBeenCalledWith(3);
    expect(screen.getByRole("link", { name: "Abrir o Pix" })).toHaveAttribute(
      "href",
      "https://checkout.livepix.gg/abc",
    );
  });

  it("credita o saldo quando o Pix confirma", async () => {
    actionMocks.getRouletteCoinPurchaseStatus.mockResolvedValue({
      ok: true,
      purchaseId,
      status: "credited",
      balanceCents: 300,
    });

    render(
      <RouletteExperience
        prizes={prizes}
        initialInventory={[]}
        initialBalanceCents={0}
        initialPurchaseId={purchaseId}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Saldo: 3,00 moedas")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Girar (1 moeda)" })).toBeEnabled();
  });

  it("vende um item do inventário e credita as moedas", async () => {
    actionMocks.sellRoulettePrize.mockResolvedValue({
      ok: true,
      prizeKey: "premio_2",
      remainingQuantity: 0,
      creditedCents: 100,
      balanceCents: 100,
    });
    const user = userEvent.setup();

    render(
      <RouletteExperience
        prizes={prizes}
        initialInventory={[{ prizeKey: "premio_2", quantity: 1 }]}
        initialBalanceCents={0}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Vender 1 por 1,00 moedas/ }));

    await waitFor(() => {
      expect(screen.getByText("Item vendido por 1,00 moedas.")).toBeInTheDocument();
    });
    expect(actionMocks.sellRoulettePrize).toHaveBeenCalledWith("premio_2");
    expect(screen.getByText("Saldo: 1,00 moedas")).toBeInTheDocument();
    expect(screen.getByText("Seu inventário está vazio")).toBeInTheDocument();
  });

  it("mostra o valor de cada item no inventário", () => {
    render(
      <RouletteExperience
        prizes={prizes}
        initialInventory={[{ prizeKey: "premio_2", quantity: 2 }]}
        initialBalanceCents={0}
      />,
    );

    const item = screen.getByRole("listitem");
    expect(within(item).getByText("vale 2,00 moedas")).toBeInTheDocument();
    expect(within(item).getByLabelText("Quantidade: 2")).toBeInTheDocument();
  });

  it("gira sem gastar moeda para o administrador", async () => {
    actionMocks.spinRoulette.mockResolvedValue({
      ok: true,
      prizeKey: "premio_2",
      inventoryQuantity: 1,
      balanceCents: 0,
      spinId: "11111111-1111-4111-8111-111111111111",
    });
    const user = userEvent.setup();

    render(
      <RouletteExperience
        prizes={prizes}
        initialInventory={[]}
        initialBalanceCents={0}
        isAdmin
      />,
    );

    await user.click(screen.getByRole("button", { name: "Girar grátis (admin)" }));

    await waitFor(() => {
      expect(screen.getByTestId("roulette-result")).toHaveTextContent("1x Dragonfly");
    });
    expect(actionMocks.startRouletteCoinPurchase).not.toHaveBeenCalled();
  });

  it("mantém a roleta bloqueada quando o inventário não está disponível", () => {
    render(
      <RouletteExperience
        prizes={prizes}
        initialInventory={[]}
        initialBalanceCents={500}
        available={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Girar (1 moeda)" })).toBeDisabled();
  });
});
