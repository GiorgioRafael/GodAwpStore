import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RouletteWheelEditor } from "./roulette-wheel-editor";

vi.mock("@/app/actions/roulette-wheel", () => ({
  saveRouletteWheelAction: vi.fn(async () => ({ ok: true, message: "Roda salva." })),
}));

const inactiveProductId = "10000000-0000-4000-8000-000000000001";
const activeProductId = "10000000-0000-4000-8000-000000000002";

describe("editor da roleta", () => {
  it("mostra claramente o prêmio que precisa ser substituído antes de salvar", async () => {
    const user = userEvent.setup();
    render(
      <RouletteWheelEditor
        slots={[
          {
            prizeKey: "premio_1",
            productId: inactiveProductId,
            productName: "Prêmio oculto",
            valueCents: 500,
            quantity: 1,
            drawWeight: 100,
            stockQuantity: 10,
            heldUnits: 0,
            retiredUnits: 0,
            archived: false,
            available: false,
          },
        ]}
        candidates={[
          {
            id: activeProductId,
            name: "Prêmio ativo",
            valueCents: 700,
            stockQuantity: 20,
          },
        ]}
        markupBps={7000}
        feeBps={500}
        saleRateBps={5000}
      />,
    );

    expect(
      screen.getByText(
        (_content, element) => element?.textContent === "Troque 1 prêmio(s) antes de salvar",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Troque os itens indisponíveis" })).toBeDisabled();
    expect(screen.getByText(/Este item não pode continuar na roda/)).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Produto da fatia premio_1" }),
      activeProductId,
    );

    expect(
      screen.queryByText(
        (_content, element) => element?.textContent === "Troque 1 prêmio(s) antes de salvar",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar roda" })).toBeEnabled();
  });
});
