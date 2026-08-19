import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MasterAdminAccessDeniedPage from "@/app/(master-auth)/admin/discordbots/acesso-negado/page";
import MasterAdminLoginPage from "@/app/(master-auth)/admin/discordbots/login/page";
import { MasterAuthShell } from "@/components/platform/master-auth-shell";

describe("acesso ao painel mestre 101Devs", () => {
  it("não apresenta o login como uma tela do GWStore", async () => {
    render(
      <MasterAuthShell>
        {await MasterAdminLoginPage({
          searchParams: Promise.resolve({ next: "/admin/discordbots" }),
        })}
      </MasterAuthShell>,
    );

    expect(screen.getByRole("link", { name: "101Devs — painel mestre dos bots" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Entre no painel mestre" })).toBeInTheDocument();
    expect(screen.queryByText(/GWStore/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continuar com Google/i })).toHaveAttribute(
      "href",
      "/auth/google/login?next=%2Fadmin%2Fdiscordbots",
    );
    expect(screen.queryByText(/Continuar com Discord/i)).not.toBeInTheDocument();
  });

  it("mantém o bloqueio dentro da identidade da 101Devs", () => {
    render(
      <MasterAuthShell>
        <MasterAdminAccessDeniedPage />
      </MasterAuthShell>,
    );

    expect(screen.getByRole("heading", { name: "Acesso não autorizado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Voltar para o login da 101Devs/i })).toHaveAttribute(
      "href",
      "/admin/discordbots/login?next=%2Fadmin",
    );
    expect(screen.queryByText(/roleta/i)).not.toBeInTheDocument();
    expect(screen.getByText(/jukersrx@gmail\.com/i)).toBeInTheDocument();
  });
});
