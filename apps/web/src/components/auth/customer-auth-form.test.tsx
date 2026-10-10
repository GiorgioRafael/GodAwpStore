import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerEmailAuthState } from "@/lib/customer-auth-state";
import { CustomerAuthForm } from "./customer-auth-form";

const NEXT = "/?checkout=1&cart=%5B%7B%22productId%22%3A%22dragon%22%2C%22quantity%22%3A2%7D%5D";
const action = vi.fn<(state: CustomerEmailAuthState, formData: FormData) => Promise<CustomerEmailAuthState>>();
const props = {
  next: NEXT,
  googleHref: `/auth/google/login?${new URLSearchParams({ next: NEXT, customer: "1" })}`,
  discordHref: `/auth/login?${new URLSearchParams({ next: NEXT })}`,
  emailAction: action,
};

beforeEach(() => {
  action.mockReset();
  action.mockResolvedValue({ status: "success", message: "Confira seu email e abra o link neste navegador." });
});

describe("acesso do cliente por Google, Discord e email", () => {
  it("oferece os provedores e preserva o destino da compra sem iniciar autenticação", () => {
    render(<CustomerAuthForm {...props} isCheckout />);
    expect(screen.getByRole("heading", { name: "Entre para concluir a compra" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuar com Google" })).toHaveAttribute("href", props.googleHref);
    expect(screen.getByRole("link", { name: "Continuar com Discord" })).toHaveAttribute("href", props.discordHref);
    expect(screen.getByRole("tab", { name: "Entrar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Senha")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByLabelText("Seu nome")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Confirmar senha")).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("troca de aba pelo teclado e envia nome, senha confirmada e next no cadastro", async () => {
    const user = userEvent.setup();
    render(<CustomerAuthForm {...props} />);
    screen.getByRole("tab", { name: "Entrar" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Criar conta" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Criar conta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Crie sua conta" })).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toHaveAttribute("autocomplete", "new-password");
    await user.type(screen.getByLabelText("Seu nome"), "Ana Souza");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "ana@example.com");
    await user.type(screen.getByLabelText("Senha"), "UmaSenha123!");
    await user.type(screen.getByLabelText("Confirmar senha"), "UmaSenha123!");
    await user.click(screen.getByRole("button", { name: "Criar conta com email" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Confira seu email");
    expect(action).toHaveBeenCalledOnce();
    expect(Object.fromEntries(action.mock.calls[0][1])).toEqual({
      mode: "signup", next: NEXT, displayName: "Ana Souza", email: "ana@example.com", password: "UmaSenha123!", confirmPassword: "UmaSenha123!",
    });
  });

  it("mostra erros associados ao campo, preserva os valores e limpa feedback ao trocar de modo", async () => {
    const user = userEvent.setup();
    action.mockResolvedValue({ status: "error", message: "Não foi possível entrar.", fieldErrors: { email: "Confira seu email." } });
    render(<CustomerAuthForm {...props} />);
    await user.type(screen.getByRole("textbox", { name: "Email" }), "ana@example.com");
    await user.type(screen.getByLabelText("Senha"), "SenhaAtual");
    await user.click(screen.getByRole("button", { name: "Entrar com email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível entrar.");
    const email = screen.getByRole("textbox", { name: "Email" });
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Confira seu email.");
    expect(email).toHaveValue("ana@example.com");
    expect(screen.getByLabelText("Senha")).toHaveValue("SenhaAtual");
    await user.click(screen.getByRole("tab", { name: "Criar conta" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ana@example.com");
    expect(screen.getByLabelText("Senha")).toHaveValue("");
  });

  it("recupera a senha somente com email e preserva email e destino ao voltar", async () => {
    const user = userEvent.setup();
    render(<CustomerAuthForm {...props} />);
    await user.type(screen.getByRole("textbox", { name: "Email" }), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
    expect(screen.getByRole("heading", { name: "Recupere sua senha" })).toHaveFocus();
    expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continuar com Google" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar link de recuperação" }));
    expect(await screen.findByRole("status")).toHaveTextContent("neste navegador");
    expect(Object.fromEntries(action.mock.calls[0][1])).toEqual({ mode: "forgot", next: NEXT, email: "ana@example.com" });
    await user.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(screen.getByRole("heading", { name: "Entre na sua conta" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ana@example.com");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("impede novo envio e troca de modo enquanto o servidor responde", async () => {
    const user = userEvent.setup();
    let finish!: (state: CustomerEmailAuthState) => void;
    action.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<CustomerAuthForm {...props} />);
    await user.type(screen.getByRole("textbox", { name: "Email" }), "ana@example.com");
    await user.type(screen.getByLabelText("Senha"), "SenhaAtual");
    await user.click(screen.getByRole("button", { name: "Entrar com email" }));
    expect(await screen.findByRole("button", { name: "Entrando..." })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Criar conta" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Esqueci minha senha" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Entrando..." }));
    expect(action).toHaveBeenCalledOnce();
    await act(async () => { finish({ status: "error", message: "Tente novamente." }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrar com email" })).toBeEnabled());
  });

  it("permite mostrar e ocultar a senha sem reenviar o formulário", async () => {
    const user = userEvent.setup();
    render(<CustomerAuthForm {...props} />);
    const password = screen.getByLabelText("Senha");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(password).toHaveAttribute("type", "password");
    expect(action).not.toHaveBeenCalled();
  });

  it("oferece nova senha e confirmação após o link de recuperação sem pedir email novamente", async () => {
    const user = userEvent.setup();
    render(<CustomerAuthForm {...props} initialMode="reset" />);
    expect(screen.getByRole("heading", { name: "Crie uma nova senha" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Senha"), "NovaSenha123!");
    await user.type(screen.getByLabelText("Confirmar senha"), "NovaSenha123!");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await screen.findByRole("status");
    expect(Object.fromEntries(action.mock.calls[0][1])).toEqual({ mode: "reset", next: NEXT, password: "NovaSenha123!", confirmPassword: "NovaSenha123!" });
  });
});
