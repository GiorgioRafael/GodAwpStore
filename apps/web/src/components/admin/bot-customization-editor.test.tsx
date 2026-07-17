import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "@/lib/bot/message-customization";

const actionMocks = vi.hoisted(() => ({
  saveBotMessageCustomizationAction: vi.fn(async () => ({
    ok: true,
    message: "Mensagens do bot atualizadas.",
  })),
}));

vi.mock("@/app/actions/admin", () => actionMocks);

import { BotCustomizationEditor } from "./bot-customization-editor";

describe("editor de mensagens do bot", () => {
  it("atualiza a prévia ao vivo e serializa a configuração global", () => {
    const { container } = render(
      <BotCustomizationEditor
        initialConfig={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        updatedAt="2026-07-17T15:00:00.000Z"
      />,
    );

    const title = screen.getByRole("textbox", { name: "Título principal" });
    fireEvent.change(title, { target: { value: "✨ Loja personalizada ✨" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Boas-vindas" }), {
      target: { value: "" },
    });

    expect(screen.getByText("✨ Loja personalizada ✨")).toBeInTheDocument();
    const serialized = container.querySelector<HTMLInputElement>('input[name="config"]');
    const expectedUpdatedAt = container.querySelector<HTMLInputElement>(
      'input[name="expectedUpdatedAt"]',
    );
    expect(serialized).not.toBeNull();
    expect(expectedUpdatedAt).toHaveValue("2026-07-17T15:00:00.000Z");
    expect(JSON.parse(serialized?.value ?? "{}")).toMatchObject({
      storefront: { title: "✨ Loja personalizada ✨", welcome: "" },
    });
  });

  it("insere somente tokens permitidos e restaura os padrões localmente", () => {
    render(
      <BotCustomizationEditor
        initialConfig={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        updatedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Produto" }));
    const productTitle = screen.getByRole("textbox", { name: "Título" });
    fireEvent.change(productTitle, { target: { value: "Oferta" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar {product_name} em Título" }));
    expect(productTitle).toHaveValue("Oferta {product_name}");

    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrões" }));
    expect(productTitle).toHaveValue(DEFAULT_BOT_MESSAGE_CUSTOMIZATION.product.title);
    expect(screen.getByText("Padrões restaurados localmente")).toBeInTheDocument();
  });
});
