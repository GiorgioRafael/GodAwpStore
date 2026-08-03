import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  deleteCatalogStoreAction: vi.fn(async () => ({
    ok: true,
    message: "Loja excluÃ­da.",
  })),
  saveCatalogStoreAction: vi.fn(async () => ({
    ok: true,
    message: "Loja salva.",
  })),
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

describe("gerenciamento de lojas do catÃ¡logo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirma a exclusÃ£o de uma loja secundÃ¡ria vazia", async () => {
    const user = userEvent.setup();
    renderManager([secondaryStore]);

    await user.click(screen.getByRole("button", { name: "Excluir loja Mundo 2" }));

    expect(screen.getByRole("heading", { name: "Excluir loja" })).toBeInTheDocument();
    expect(screen.getByText(/canal permanecerÃ¡ no servidor/i)).toBeInTheDocument();
    expect(actionMocks.deleteCatalogStoreAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirmar exclusÃ£o" }));

    await waitFor(() => {
      expect(actionMocks.deleteCatalogStoreAction).toHaveBeenCalledWith(secondaryStore.id);
    });
    expect(await screen.findByText("Loja excluÃ­da.")).toBeInTheDocument();
  });

  it("bloqueia a exclusÃ£o enquanto a loja possui produtos", async () => {
    const user = userEvent.setup();
    renderManager([{ ...secondaryStore, productCount: 3 }]);

    await user.click(screen.getByRole("button", { name: "Excluir loja Mundo 2" }));

    expect(screen.getByText(/Mova os 3 produto\(s\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar exclusÃ£o" })).toBeDisabled();
    expect(actionMocks.deleteCatalogStoreAction).not.toHaveBeenCalled();
  });

  it("protege a loja principal", () => {
    renderManager([{ ...secondaryStore, isDefault: true, name: "Loja principal" }]);

    expect(screen.queryByRole("button", { name: /Excluir loja/ })).not.toBeInTheDocument();
    expect(screen.getByText(/nÃ£o pode ser excluÃ­da separadamente/i)).toBeInTheDocument();
  });
});

function renderManager(stores: CatalogStoreManagerStore[]) {
  return render(
    <CatalogStoresManager
      stores={stores}
      games={[{ id: secondaryStore.gameId, name: secondaryStore.gameName }]}
      guilds={[{ id: "66e7d68b-3c95-4926-8328-e5d41611ff7e", name: "GW Store" }]}
    />,
  );
}
