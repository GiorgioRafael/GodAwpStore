import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  spinDemoRoulette: vi.fn(),
}));

vi.mock("@/app/roleta/actions", () => actionMocks);

import { RouletteExperience } from "./roulette-experience";

describe("RouletteExperience", () => {
  beforeEach(() => {
    actionMocks.spinDemoRoulette.mockReset();
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

  it("gira, mostra o resultado e atualiza o inventário", async () => {
    actionMocks.spinDemoRoulette.mockResolvedValue({
      ok: true,
      prizeKey: "premio_2",
      inventoryQuantity: 2,
      spinId: "11111111-1111-4111-8111-111111111111",
    });
    const user = userEvent.setup();

    render(
      <RouletteExperience
        initialInventory={[{ prizeKey: "premio_2", quantity: 1 }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Girar roleta" }));

    await waitFor(() => {
      expect(screen.getByTestId("roulette-result")).toHaveTextContent("Prêmio 2");
    });
    expect(screen.getByLabelText("Quantidade: 2")).toBeInTheDocument();
    expect(actionMocks.spinDemoRoulette).toHaveBeenCalledTimes(1);
  });

  it("mantém a roleta bloqueada quando o inventário não está disponível", () => {
    render(<RouletteExperience initialInventory={[]} available={false} />);
    expect(screen.getByRole("button", { name: "Girar roleta" })).toBeDisabled();
  });
});
