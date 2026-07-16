import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryManager, type InventoryUnit } from "./inventory-manager";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/actions/admin", () => ({
  changeInventoryStatusAction: vi.fn(async () => ({ ok: true, message: "Estado atualizado." })),
}));

const product = { id: "6d555f6e-b780-4584-97b8-01f3b98c20a6", name: "AWP Asiimov", status: "active" };
const unit: InventoryUnit = {
  id: "91ce779b-13c0-4eaf-9514-0d7b8562b5d2",
  productId: product.id,
  productName: product.name,
  batchId: "0b7bd71c-a4db-469e-94ee-204a6dcd52a7",
  batchSource: "lote-julho.txt",
  status: "available",
  createdAt: "2026-07-16T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z",
};

describe("InventoryManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("mostra estado vazio real quando ainda não há catálogo ou estoque", () => {
    render(<InventoryManager products={[]} stock={[]} units={[]} batches={[]} />);

    expect(screen.getByRole("button", { name: "Unidade manual" })).toBeDisabled();
    expect(screen.getByText("Nenhuma unidade encontrada")).toBeInTheDocument();
  });

  it("filtra unidades por busca e estado", async () => {
    const user = userEvent.setup();
    const quarantined = { ...unit, id: "64c44373-fd76-484a-8476-fd1e33a046e7", productName: "Outro item", status: "quarantined" as const };
    render(<InventoryManager products={[product]} stock={[]} units={[unit, quarantined]} batches={[]} />);

    await user.type(screen.getByRole("textbox", { name: "Buscar unidade ou lote" }), "Outro item");
    const table = screen.getByRole("table", { name: "Unidades do estoque" });
    expect(within(table).getByText("Outro item")).toBeInTheDocument();
    expect(within(table).queryByText("AWP Asiimov")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: "Buscar unidade ou lote" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar por estado" }), "quarantined");
    expect(within(table).getByText("Quarentena")).toBeInTheDocument();
    expect(within(table).queryByText("Disponível")).not.toBeInTheDocument();
  });

  it("gera prévia mascarada e só então confirma uma importação", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        valid: true,
        count: 1,
        entries: [{ lineNumber: 1, maskedSecret: "SE•••TO", duplicateInStock: false }],
        issues: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ importedCount: 1 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }));

    render(<InventoryManager products={[product]} stock={[]} units={[]} batches={[]} />);
    await user.click(screen.getByRole("button", { name: "Unidade manual" }));
    await user.type(screen.getByLabelText("Conteúdo secreto"), "SEGREDO");
    expect(screen.getByRole("button", { name: /Confirmar/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Gerar prévia" }));
    expect(await screen.findByText("SE•••TO")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar (1)" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Confirmar (1)" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      mode: "commit",
      importMethod: "manual",
      format: "txt",
      requestId: expect.any(String),
    });
  });

  it("sinaliza unidade duplicada e impede a confirmação do lote", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        valid: false,
        count: 1,
        entries: [{ lineNumber: 1, maskedSecret: "SE•••TO", duplicateInStock: true }],
        issues: [{ message: "O lote contém unidades já cadastradas." }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    render(<InventoryManager products={[product]} stock={[]} units={[]} batches={[]} />);
    await user.click(screen.getByRole("button", { name: "Unidade manual" }));
    await user.type(screen.getByLabelText("Conteúdo secreto"), "SEGREDO-DUPLICADO");
    await user.click(screen.getByRole("button", { name: "Gerar prévia" }));

    expect(await screen.findByText("Duplicada")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("O lote contém unidades já cadastradas.");
    expect(screen.getByRole("button", { name: "Confirmar (1)" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("revela conteúdo apenas após ação explícita e solicita resposta sem cache", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ secret: "conteudo-ultrassecreto" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<InventoryManager products={[product]} stock={[]} units={[unit]} batches={[]} />);
    expect(screen.queryByText("conteudo-ultrassecreto")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Revelar" }));
    expect(await screen.findByText("conteudo-ultrassecreto")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/inventory/${unit.id}/reveal`,
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });
});
