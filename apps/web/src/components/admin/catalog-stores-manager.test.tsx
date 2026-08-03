import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  deleteCatalogStoreAction: vi.fn(async () => ({
    ok: true,
    message: "Loja excluída.",
  })),
  saveCatalogStoreAction: vi.fn(async (_previousState: unknown, _formData: FormData) => {
    void _previousState;
    void _formData;
    return { ok: true, message: "Loja salva." };
  }),
  renameCatalogGameAction: vi.fn(async (_previousState: unknown, _formData: FormData) => {
    void _previousState;
    void _formData;
    return { ok: true, message: "Nome do jogo atualizado." };
  }),
}));

vi.mock("@/app/actions/admin", () => actionMocks);

import {
  CatalogStoresManager,
  type CatalogStoreManagerStore,
} from "./catalog-stores-manager";

const secondaryStore: CatalogStoreManagerStore = {
  id: "95a1983f-c5a3-4b72-89d0-0cf18fa1bbd5",
  gameId: "ffdcfe41-29b9-4140-9182-f1cbcbd8276f",
  gameName: "Grow a Garden 2",
  name: "Mundo 2",
  isDefault: false,
  productCount: 0,
};
const secondGame = {
  id: "8a162fbe-7977-44ef-8357-ef90c594b55d",
  name: "Grow a Garden 3",
};

describe("gerenciamento de lojas do catálogo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirma a exclusão de uma loja secundária vazia", async () => {
    const user = userEvent.setup();
    renderManager([secondaryStore]);

    await user.click(screen.getByRole("button", { name: "Excluir loja Mundo 2" }));

    expect(screen.getByRole("heading", { name: "Excluir loja" })).toBeInTheDocument();
    expect(screen.getByText(/canal permanecerá no servidor/i)).toBeInTheDocument();
    expect(actionMocks.deleteCatalogStoreAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() => {
      expect(actionMocks.deleteCatalogStoreAction).toHaveBeenCalledWith(secondaryStore.id);
    });
    expect(await screen.findByText("Loja excluída.")).toBeInTheDocument();
  });

  it("bloqueia a exclusão enquanto a loja possui produtos", async () => {
    const user = userEvent.setup();
    renderManager([{ ...secondaryStore, productCount: 3 }]);

    await user.click(screen.getByRole("button", { name: "Excluir loja Mundo 2" }));

    expect(screen.getByText(/Mova os 3 produto\(s\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar exclusão" })).toBeDisabled();
    expect(actionMocks.deleteCatalogStoreAction).not.toHaveBeenCalled();
  });

  it("protege a loja principal", () => {
    renderManager([{ ...secondaryStore, isDefault: true, name: "Loja principal" }]);

    expect(screen.queryByRole("button", { name: /Excluir loja/ })).not.toBeInTheDocument();
    expect(screen.getByText(/não pode ser excluída ou movida separadamente/i)).toBeInTheDocument();
  });

  it("permite mover uma loja secundária vazia para outro jogo", async () => {
    const user = userEvent.setup();
    renderManager([secondaryStore]);

    const gameSelect = screen.getByRole("combobox", { name: "Jogo da loja" });
    expect(gameSelect).toBeEnabled();
    await user.selectOptions(gameSelect, secondGame.id);
    await user.click(screen.getByRole("button", { name: "Salvar loja" }));

    await waitFor(() => expect(actionMocks.saveCatalogStoreAction).toHaveBeenCalled());
    const formData = actionMocks.saveCatalogStoreAction.mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get("gameId")).toBe(secondGame.id);
  });

  it("permite renomear o jogo nas configurações", async () => {
    const user = userEvent.setup();
    renderManager([secondaryStore]);

    await user.click(screen.getByText("Renomear jogos"));
    const input = screen.getByRole("textbox", { name: `Nome do jogo ${secondaryStore.gameName}` });
    await user.clear(input);
    await user.type(input, "Grow a Garden Mundo 1");
    await user.click(screen.getByRole("button", { name: `Salvar nome do jogo ${secondaryStore.gameName}` }));

    await waitFor(() => expect(actionMocks.renameCatalogGameAction).toHaveBeenCalled());
    const formData = actionMocks.renameCatalogGameAction.mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get("name")).toBe("Grow a Garden Mundo 1");
  });
});

function renderManager(stores: CatalogStoreManagerStore[]) {
  return render(
    <CatalogStoresManager
      stores={stores}
      games={[
        { id: secondaryStore.gameId, name: secondaryStore.gameName },
        secondGame,
      ]}
      guilds={[{ id: "66e7d68b-3c95-4926-8328-e5d41611ff7e", name: "GW Store" }]}
    />,
  );
}
