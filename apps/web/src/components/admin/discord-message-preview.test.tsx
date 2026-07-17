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
});
