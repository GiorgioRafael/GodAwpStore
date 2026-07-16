import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AccessDeniedPage from "@/app/(auth)/acesso-negado/page";
import LoginPage from "@/app/(auth)/login/page";

describe("páginas de autenticação", () => {
  it("oferece login Discord na página inicial de acesso", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Entre no painel" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continuar com Discord/i })).toHaveAttribute(
      "href",
      "/auth/login?next=/",
    );
  });

  it("explica o bloqueio para um Discord ID fora da lista", () => {
    render(<AccessDeniedPage />);

    expect(screen.getByRole("heading", { name: "Acesso não autorizado" })).toBeInTheDocument();
    expect(screen.getByText(/não está na lista de administradores/i)).toBeInTheDocument();
  });
});
