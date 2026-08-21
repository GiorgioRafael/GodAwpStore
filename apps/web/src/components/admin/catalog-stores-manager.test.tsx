import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  archiveCatalogStoreAction: vi.fn(async () => ({
    ok: true,
    message: "Loja arquivada.",
  })),
  deleteRecordPermanentlyAction: vi.fn(async () => ({
    ok: true,
    message: "Loja excluída definitivamente.",
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
  bannerUrl: "https://example.com/mundo-2.webp",
  isDefault: false,
  liveProductCount: 0,
  totalProductCount: 0,
};
const secondGame = {
  id: "8a162fbe-7977-44ef-8357-ef90c594b55d",
  name: "Grow a Garden 3",
};

describe("gerenciamento de lojas do catálogo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirma a exclusão definitiva de uma loja secundária vazia", async () => {
    const user = userEvent.setup();
    renderManager([secondaryStore]);

    await user.click(screen.getByRole("button", { name: "Excluir definitivamente loja Mundo 2" }));

    expect(screen.getByRole("heading", { name: "Excluir loja definitivamente" })).toBeInTheDocument();
    expect(screen.getByText(/canal do Discord será preservado/i)).toBeInTheDocument();
    expect(actionMocks.deleteRecordPermanentlyAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Excluir definitivamente" }));

    await waitFor(() => {
      expect(actionMocks.deleteRecordPermanentlyAction).toHaveBeenCalledWith(
        "catalogStore",
        secondaryStore.id,
      );
    });
    expect(await screen.findByText("Loja excluída definitivamente.")).toBeInTheDocument();
  });

  it("arquiva com zero produtos vivos, mas bloqueia a exclusão por produtos arquivados", async () => {
    const user = userEvent.setup();
    renderManager([{ ...secondaryStore, liveProductCount: 0, totalProductCount: 3 }]);

    await user.click(screen.getByRole("button", { name: "Arquivar loja Mundo 2" }));
    expect(screen.getByRole("button", { name: "Confirmar arquivamento" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Confirmar arquivamento" }));
    await waitFor(() => {
      expect(actionMocks.archiveCatalogStoreAction).toHaveBeenCalledWith(secondaryStore.id);
    });
    await user.click(screen.getByRole("button", { name: "Concluir" }));

    await user.click(screen.getByRole("button", { name: "Excluir definitivamente loja Mundo 2" }));
    expect(screen.getByText(/incluindo arquivados/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir definitivamente" })).toBeDisabled();
    expect(actionMocks.deleteRecordPermanentlyAction).not.toHaveBeenCalled();
  });

  it("mantém as duas ações visíveis e protegidas na loja principal", async () => {
    const user = userEvent.setup();
    renderManager([{ ...secondaryStore, isDefault: true, name: "Loja principal" }]);

    expect(screen.getByRole("button", { name: "Arquivar loja Loja principal" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Excluir definitivamente loja Loja principal" }));
    expect(screen.getByText(/loja principal é protegida/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir definitivamente" })).toBeDisabled();
    expect(screen.getByText(/não pode ser excluída ou movida separadamente/i)).toBeInTheDocument();
  });

  it("desvincula o banner próprio ao salvar e volta ao banner global", async () => {
    const user = userEvent.setup();
    renderManager([secondaryStore]);

    const clearStoreBannerButton = screen
      .getAllByRole("button", { name: "Usar banner global" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(clearStoreBannerButton).toBeDefined();
    await user.click(clearStoreBannerButton!);
    await user.click(screen.getByRole("button", { name: "Salvar loja" }));

    await waitFor(() => expect(actionMocks.saveCatalogStoreAction).toHaveBeenCalled());
    const formData = actionMocks.saveCatalogStoreAction.mock.calls.at(-1)?.[1] as FormData;
    expect(formData.get("bannerUrl")).toBe("");
    expect(screen.getByText(/banner global será usado/i)).toBeInTheDocument();
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
