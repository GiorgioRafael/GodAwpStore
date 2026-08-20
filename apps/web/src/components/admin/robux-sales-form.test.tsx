import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/admin", () => ({
  publishDiscordRobuxStorefrontAction: vi.fn(),
}));

import { RobuxSalesForm } from "./robux-sales-form";

describe("RobuxSalesForm", () => {
  it("explains the separate Robux channel and enables publication after selecting one", async () => {
    const user = userEvent.setup();
    render(
      <RobuxSalesForm
        guilds={[
          {
            id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
            discordGuildId: "123456789012345678",
            name: "GWStore",
            channels: [
              {
                id: "223456789012345678",
                name: "robux",
                type: 0,
                position: 1,
                parentId: null,
                categoryName: null,
              },
            ],
            current: [],
            robux: null,
            boosterDiscount: {
              enabled: true,
              discount_bps: 500,
              minimum_subtotal_cents: 5_000,
            },
            channelLoadError: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Venda de Robux" })).toBeInTheDocument();
    const channel = screen.getByLabelText("Canal da mensagem de Robux");
    expect(channel).toBeInTheDocument();
    expect(screen.getByText("1.000 Robux = R$ 35,00")).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "Publicar mensagem" });
    expect(publish).toBeDisabled();
    await user.type(channel, "223456789012345678");
    expect(publish).toBeEnabled();
  });
});
