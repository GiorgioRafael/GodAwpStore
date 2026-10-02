import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResourceTable } from "./resource-table";

describe("busca nas tabelas de consulta", () => {
  it("filtra por múltiplos termos e acentos e recupera os registros ao limpar", async () => {
    const user = userEvent.setup();
    render(<ResourceTable title="Servidores" columns={["Servidor"]}
      rows={[
        <tr key="1"><td>Operação São Paulo</td></tr>,
        <tr key="2"><td>Loja Rio de Janeiro</td></tr>,
      ]}
      searchValues={["Operação São Paulo 111", "Loja Rio de Janeiro 222"]}
      emptyState={<p>Nenhum servidor conectado</p>} readOnly />);
    await user.type(screen.getByRole("searchbox"), "sao 111");
    expect(within(screen.getByRole("table")).getByText("Operação São Paulo")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("Loja Rio de Janeiro")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 de 2 registros encontrados");
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "inexistente");
    expect(screen.getByText("Nenhum resultado encontrado")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Limpar busca" })[0]);
    expect(within(screen.getByRole("table")).getByText("Loja Rio de Janeiro")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 registros carregados");
  });
});
