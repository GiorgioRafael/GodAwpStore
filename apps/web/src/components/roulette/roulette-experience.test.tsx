import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  spinRoulette: vi.fn(),
  startRouletteSpinPayment: vi.fn(),
  getRouletteSpinPaymentStatus: vi.fn(),
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
  },
]);
const chargeId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";

describe("RouletteExperience", () => {
  beforeEach(() => {
    actionMocks.spinRoulette.mockReset();
    actionMocks.startRouletteSpinPayment.mockReset();
    actionMocks.getRouletteSpinPaymentStatus.mockReset();
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

  it("cobra R$ 1,00 antes de girar e aguarda a confirmação do Pix", async () => {
    actionMocks.startRouletteSpinPayment.mockResolvedValue({
      ok: true,
      chargeId,
      status: "awaiting_payment",
      checkoutUrl: "https://checkout.livepix.gg/abc",
      amountCents: 100,
    });
    actionMocks.getRouletteSpinPaymentStatus.mockResolvedValue({
      ok: true,
      chargeId,
      status: "awaiting_payment",
    });
    const user = userEvent.setup();

    render(<RouletteExperience prizes={prizes} initialInventory={[]} />);

    await user.click(screen.getByRole("button", { name: "Girar por R$ 1,00" }));

    await waitFor(() => {
      expect(screen.getByText("Aguardando a confirmação do Pix")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Abrir o Pix de R$ 1,00" })).toHaveAttribute(
      "href",
      "https://checkout.livepix.gg/abc",
    );
    expect(actionMocks.spinRoulette).not.toHaveBeenCalled();
  });

  it("gira direto quando a cobrança já está paga e mostra o item do catálogo", async () => {
    actionMocks.startRouletteSpinPayment.mockResolvedValue({
      ok: true,
      chargeId,
      status: "paid",
      checkoutUrl: null,
      amountCents: 100,
    });
    actionMocks.spinRoulette.mockResolvedValue({
      ok: true,
      prizeKey: "premio_2",
      inventoryQuantity: 2,
      spinId: "11111111-1111-4111-8111-111111111111",
    });
    const user = userEvent.setup();

    render(
      <RouletteExperience
        prizes={prizes}
        initialInventory={[{ prizeKey: "premio_2", quantity: 1 }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Girar por R$ 1,00" }));

    await waitFor(() => {
      expect(screen.getByTestId("roulette-result")).toHaveTextContent("1x Dragonfly");
    });
    expect(screen.getByLabelText("Quantidade: 2")).toBeInTheDocument();
    expect(actionMocks.spinRoulette).toHaveBeenCalledWith(chargeId);
  });

  it("retoma o giro pago ao voltar da LivePix sem cobrar de novo", async () => {
    actionMocks.getRouletteSpinPaymentStatus.mockResolvedValue({
      ok: true,
      chargeId,
      status: "paid",
    });
    actionMocks.spinRoulette.mockResolvedValue({
      ok: true,
      prizeKey: "premio_2",
      inventoryQuantity: 1,
      spinId: "11111111-1111-4111-8111-111111111111",
    });

    render(
      <RouletteExperience
        prizes={prizes}
        initialInventory={[]}
        initialChargeId={chargeId}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("roulette-result")).toHaveTextContent("1x Dragonfly");
    });
    expect(actionMocks.startRouletteSpinPayment).not.toHaveBeenCalled();
    expect(actionMocks.spinRoulette).toHaveBeenCalledWith(chargeId);
  });

  it("gira sem cobrança para o administrador em teste interno", async () => {
    actionMocks.spinRoulette.mockResolvedValue({
      ok: true,
      prizeKey: "premio_2",
      inventoryQuantity: 1,
      spinId: "11111111-1111-4111-8111-111111111111",
    });
    const user = userEvent.setup();

    render(<RouletteExperience prizes={prizes} initialInventory={[]} isAdmin />);

    await user.click(screen.getByRole("button", { name: "Girar grátis (admin)" }));

    await waitFor(() => {
      expect(screen.getByTestId("roulette-result")).toHaveTextContent("1x Dragonfly");
    });
    expect(actionMocks.startRouletteSpinPayment).not.toHaveBeenCalled();
    expect(actionMocks.spinRoulette).toHaveBeenCalledWith(null);
  });

  it("mostra o erro quando a cobrança não pode ser aberta", async () => {
    actionMocks.startRouletteSpinPayment.mockResolvedValue({
      ok: false,
      message: "Não foi possível abrir o Pix do giro. Tente novamente.",
    });
    const user = userEvent.setup();

    render(<RouletteExperience prizes={prizes} initialInventory={[]} />);

    await user.click(screen.getByRole("button", { name: "Girar por R$ 1,00" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Não foi possível abrir o Pix do giro. Tente novamente.",
      );
    });
    expect(screen.getByRole("button", { name: "Girar por R$ 1,00" })).toBeEnabled();
  });

  it("mantém a roleta bloqueada quando o inventário não está disponível", () => {
    render(
      <RouletteExperience prizes={prizes} initialInventory={[]} available={false} />,
    );
    expect(screen.getByRole("button", { name: "Girar por R$ 1,00" })).toBeDisabled();
  });
});
