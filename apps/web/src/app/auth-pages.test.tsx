import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AccessDeniedPage from "@/app/(auth)/acesso-negado/page";
import LoginPage from "@/app/(auth)/login/page";
import { AuthShell } from "@/components/layout/auth-shell";

describe("páginas de autenticação", () => {
  it("oferece login Discord na página inicial de acesso", async () => {
    render(
      <AuthShell>{await LoginPage({ searchParams: Promise.resolve({}) })}</AuthShell>,
    );

    expect(screen.getByRole("link", { name: "GWStore — início" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Entre no painel" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continuar com Discord/i })).toHaveAttribute(
      "href",
      "/auth/login?next=%2F",
    );
  });

  it("preserva o destino do painel no inÃ­cio do OAuth", async () => {
    render(
      <AuthShell>
        {await LoginPage({
          searchParams: Promise.resolve({ next: "/admin/discordbots?periodo=atual" }),
        })}
      </AuthShell>,
    );

    expect(screen.getByRole("link", { name: /Continuar com Discord/i })).toHaveAttribute(
      "href",
      "/auth/login?next=%2Fadmin%2Fdiscordbots%3Fperiodo%3Datual",
    );
  });

  it("explica o bloqueio para um Discord ID fora da lista", () => {
    render(<AccessDeniedPage />);

    expect(screen.getByRole("heading", { name: "Acesso não autorizado" })).toBeInTheDocument();
    expect(screen.getByText(/não está na lista de administradores/i)).toBeInTheDocument();
  });
});
