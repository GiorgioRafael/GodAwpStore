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
            current: [
              {
                game_id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
                game_name: "ROBUX",
                catalog_store_id: "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
                catalog_store_name: "ROBUX VIA GAMEPASS",
                channel_id: "223456789012345678",
                channel_name: "robux",
                message_ids: ["323456789012345678"],
                published_at: "2026-08-20T12:00:00.000Z",
              },
            ],
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
    expect(screen.getByText(/confere o valor e só então gera o Pix/i)).toBeInTheDocument();
    expect(screen.getByText(/substituirá a vitrine antiga de produtos de Robux/i)).toBeInTheDocument();
    const channel = screen.getByLabelText("Canal da mensagem de Robux");
    expect(channel).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "#robux" })).toBeInTheDocument();
    expect(screen.getByText("1.000 Robux = R$ 42,00")).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "Publicar mensagem" });
    expect(publish).toBeEnabled();
    await user.selectOptions(channel, "");
    expect(publish).toBeDisabled();
    await user.selectOptions(channel, "223456789012345678");
    expect(publish).toBeEnabled();
  });
});
