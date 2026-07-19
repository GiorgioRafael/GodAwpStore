import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "@/lib/bot/message-customization";
import { DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS } from "@/lib/bot/ticket-close-admins";
import { DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS } from "@/lib/bot/ticket-notifications";

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
        initialNotificationDiscordUserIds={[...DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS]}
        initialTicketCloseAdminDiscordUserIds={[...DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS]}
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
        initialNotificationDiscordUserIds={[...DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS]}
        initialTicketCloseAdminDiscordUserIds={[...DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS]}
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

  it("edita e visualiza o fluxo de coleta do nick no ticket", () => {
    const { container } = render(
      <BotCustomizationEditor
        initialConfig={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        initialNotificationDiscordUserIds={[...DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS]}
        initialTicketCloseAdminDiscordUserIds={[...DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS]}
        updatedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ticket" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Orientação antes do botão" }), {
      target: { value: "Envie seu nick agora." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Botão para informar o nick" }), {
      target: { value: "Cadastrar nick" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Título do modal de nick" }), {
      target: { value: "Seu nick" },
    });

    const savedText = screen.getByRole("textbox", { name: "Confirmação do nick recebido" });
    fireEvent.change(savedText, { target: { value: "Recebido:" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Adicionar {game_nickname} em Confirmação do nick recebido",
      }),
    );

    expect(savedText).toHaveValue("Recebido: {game_nickname}");
    expect(screen.getByText("Envie seu nick agora.", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Cadastrar nick")).toBeInTheDocument();
    expect(screen.getByText("Seu nick")).toBeInTheDocument();
    expect(screen.getByText("Recebido: Speedy_BR", { selector: "p" })).toBeInTheDocument();

    const serialized = container.querySelector<HTMLInputElement>('input[name="config"]');
    expect(JSON.parse(serialized?.value ?? "{}")).toMatchObject({
      ticket: {
        nicknamePromptText: "Envie seu nick agora.",
        nicknameButtonLabel: "Cadastrar nick",
        nicknameSavedText: "Recebido: {game_nickname}",
      },
    });
  });

  it("adiciona e remove pessoas notificadas e serializa a lista", () => {
    const { container } = render(
      <BotCustomizationEditor
        initialConfig={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        initialNotificationDiscordUserIds={[...DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS]}
        initialTicketCloseAdminDiscordUserIds={[...DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS]}
        updatedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByText("385924725332901909")).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Discord ID" });
    fireEvent.change(input, { target: { value: "911402638975844354" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("911402638975844354")).toBeInTheDocument();
    expect(screen.getByText("@911402638975844354")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remover Discord ID 385924725332901909" }),
    );
    expect(screen.queryByText("385924725332901909")).not.toBeInTheDocument();

    const serialized = container.querySelector<HTMLInputElement>(
      'input[name="notificationDiscordUserIds"]',
    );
    expect(JSON.parse(serialized?.value ?? "[]")).toEqual(["911402638975844354"]);
  });

  it("mostra erros para Discord ID inválido e duplicado e restaura o padrão", () => {
    const { container } = render(
      <BotCustomizationEditor
        initialConfig={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        initialNotificationDiscordUserIds={[]}
        initialTicketCloseAdminDiscordUserIds={[...DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS]}
        updatedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByText("Ninguém será notificado")).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Discord ID" });
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("15 a 22 dígitos");

    fireEvent.change(input, { target: { value: "385924725332901909" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    fireEvent.change(input, { target: { value: "385924725332901909" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("já está na lista");

    fireEvent.click(screen.getByRole("button", { name: "Remover Discord ID 385924725332901909" }));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrões" }));

    const serialized = container.querySelector<HTMLInputElement>(
      'input[name="notificationDiscordUserIds"]',
    );
    expect(JSON.parse(serialized?.value ?? "[]")).toEqual([
      "385924725332901909",
    ]);
    const closeAdmins = container.querySelector<HTMLInputElement>(
      'input[name="ticketCloseAdminDiscordUserIds"]',
    );
    expect(JSON.parse(closeAdmins?.value ?? "[]")).toEqual(
      DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
    );
  });

  it("edita os textos completos do fechamento e atualiza a prévia", () => {
    const { container } = render(
      <BotCustomizationEditor
        initialConfig={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        initialNotificationDiscordUserIds={[...DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS]}
        initialTicketCloseAdminDiscordUserIds={[...DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS]}
        updatedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ticket" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Botão para fechar o ticket" }), {
      target: { value: "Encerrar atendimento" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Confirmação de fechamento" }), {
      target: { value: "Deseja realmente encerrar?" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Botão para confirmar" }), {
      target: { value: "Sim, encerrar" },
    });

    expect(screen.getByText("Encerrar atendimento")).toBeInTheDocument();
    expect(screen.getByText("Deseja realmente encerrar?", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Sim, encerrar")).toBeInTheDocument();

    const serialized = container.querySelector<HTMLInputElement>('input[name="config"]');
    expect(JSON.parse(serialized?.value ?? "{}")).toMatchObject({
      ticket: {
        closeButtonLabel: "Encerrar atendimento",
        closeConfirmationText: "Deseja realmente encerrar?",
        closeConfirmButtonLabel: "Sim, encerrar",
      },
    });
  });

  it("mantém administradores de fechamento separados das pessoas notificadas", () => {
    const { container } = render(
      <BotCustomizationEditor
        initialConfig={DEFAULT_BOT_MESSAGE_CUSTOMIZATION}
        initialNotificationDiscordUserIds={["385924725332901909"]}
        initialTicketCloseAdminDiscordUserIds={[]}
        updatedAt={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fechamento" }));
    expect(
      screen.getByText("Nenhum administrador poderá fechar tickets pelo bot"),
    ).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Discord ID autorizado a fechar" });
    fireEvent.change(input, { target: { value: "911402638975844354" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("911402638975844354")).toBeInTheDocument();
    expect(screen.queryByText("@911402638975844354")).not.toBeInTheDocument();
    expect(screen.getByText(/1 administrador\(es\) autorizado\(s\)/)).toBeInTheDocument();

    const closeAdmins = container.querySelector<HTMLInputElement>(
      'input[name="ticketCloseAdminDiscordUserIds"]',
    );
    const notifications = container.querySelector<HTMLInputElement>(
      'input[name="notificationDiscordUserIds"]',
    );
    expect(JSON.parse(closeAdmins?.value ?? "[]")).toEqual(["911402638975844354"]);
    expect(JSON.parse(notifications?.value ?? "[]")).toEqual(["385924725332901909"]);

    fireEvent.change(input, { target: { value: "911402638975844354" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar administrador" }));
    expect(screen.getByRole("alert")).toHaveTextContent("já está na lista de fechamento");
  });
});
