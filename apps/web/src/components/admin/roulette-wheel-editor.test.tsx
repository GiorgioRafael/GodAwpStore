import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const saveRouletteWheelAction = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, message: "Roda salva." })),
);

vi.mock("@/app/actions/roulette-wheel", () => ({ saveRouletteWheelAction }));

import { RouletteWheelEditor, type WheelSlot } from "./roulette-wheel-editor";

const slots: WheelSlot[] = [
  {
    prizeKey: "slot-a",
    productId: "11111111-1111-4111-8111-111111111111",
    productName: "Item A",
    valueCents: 100,
    quantity: 1,
    drawWeight: 10,
    stockQuantity: 10,
    heldUnits: 0,
    retiredUnits: 0,
    archived: false,
  },
  {
    prizeKey: "slot-b",
    productId: "22222222-2222-4222-8222-222222222222",
    productName: "Item B",
    valueCents: 200,
    quantity: 1,
    drawWeight: 5,
    stockQuantity: 10,
    heldUnits: 0,
    retiredUnits: 0,
    archived: false,
  },
];

describe("RouletteWheelEditor", () => {
  it("remove a fatia somente do rascunho e explica quando a alteração persiste", async () => {
    const user = userEvent.setup();
    render(
      <RouletteWheelEditor
        slots={slots}
        candidates={slots.map((slot) => ({
          id: slot.productId,
          name: slot.productName,
          valueCents: slot.valueCents,
          stockQuantity: slot.stockQuantity,
        }))}
        markupBps={3_000}
        feeBps={500}
        saleRateBps={5_000}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remover a fatia slot-b" }));

    expect(screen.queryByRole("button", { name: "Remover a fatia slot-b" })).not.toBeInTheDocument();
    expect(screen.getByText(/só são persistidas ao salvar/i)).toBeInTheDocument();
    expect(saveRouletteWheelAction).not.toHaveBeenCalled();
  });
});
