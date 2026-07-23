import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid="bar" data-key={dataKey} />,
  Line: ({ dataKey }: { dataKey: string }) => <div data-testid="line" data-key={dataKey} />,
}));

import { OrdersChart } from "./orders-chart";

const points = [
  { date: "2026-07-22", ordersCount: 4, paidOrdersCount: 2, revenueCents: 1_500 },
];

describe("OrdersChart", () => {
  it("inicia em receita e 30 dias e permite alternar os controles", async () => {
    const user = userEvent.setup();
    render(<OrdersChart points={points} />);

    expect(screen.getByRole("button", { name: "Receita" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30D" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("bar")).toHaveAttribute("data-key", "value");
    expect(screen.getByTestId("line")).toHaveAttribute("data-key", "movingAverage7");

    await user.click(screen.getByRole("button", { name: "Pedidos" }));
    await user.click(screen.getByRole("button", { name: "90D" }));

    expect(screen.getByRole("button", { name: "Pedidos" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "90D" })).toHaveAttribute("aria-pressed", "true");
  });

  it("mostra estado vazio quando não existe movimento", () => {
    render(<OrdersChart points={[]} />);
    expect(screen.getByText("Sem movimento neste período")).toBeInTheDocument();
  });
});
