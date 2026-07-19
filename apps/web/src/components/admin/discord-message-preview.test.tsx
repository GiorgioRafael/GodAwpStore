import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "@/lib/bot/message-customization";
import { DiscordMessagePreview } from "./discord-message-preview";

describe("prévia das mensagens do Discord", () => {
  it("mostra HTML como texto e não interpola variável proibida no campo", () => {
    const config = {
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      storefront: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.storefront,
        title: "<img src=x onerror=alert(1)> {store_name}",
      },
    };

    const { container } = render(
      <DiscordMessagePreview
        config={config}
        scenario="storefront"
        onScenarioChange={vi.fn()}
      />,
    );

    expect(screen.getByText("<img src=x onerror=alert(1)> {store_name}")).toBeInTheDocument();
    expect(container.querySelector("img[src='x']")).toBeNull();
  });

  it("interpola somente as variáveis permitidas no detalhe do produto", () => {
    render(
      <DiscordMessagePreview
        config={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        scenario="product"
        onScenarioChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Dragon's Breath/)).toBeInTheDocument();
    expect(screen.queryByText(/\{product_name\}/)).not.toBeInTheDocument();
  });

  it("mostra na prévia do ticket todas as pessoas que serão mencionadas", () => {
    render(
      <DiscordMessagePreview
        config={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        notificationDiscordUserIds={["385924725332901909", "911402638975844354"]}
        ticketCloseAdminDiscordUserIds={["234486394414825472"]}
        scenario="ticket"
        onScenarioChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Menções da mensagem do ticket")).toHaveTextContent(
      "@comprador",
    );
    expect(screen.getByText("@385924725332901909")).toBeInTheDocument();
    expect(screen.getByText("@911402638975844354")).toBeInTheDocument();
    expect(screen.queryByText("@234486394414825472")).not.toBeInTheDocument();
    expect(screen.getByText(DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.closeButtonLabel)).toBeInTheDocument();
    expect(
      screen.getByText(DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.closeConfirmationText),
    ).toBeInTheDocument();
    expect(
      screen.getByText(DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.closeConfirmButtonLabel),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.closeCancelButtonLabel),
    ).toHaveLength(2);
    expect(screen.getByText(/1 administrador\(es\) autorizado\(s\)/)).toBeInTheDocument();
  });
});
