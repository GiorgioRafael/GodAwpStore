import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GamesManager } from "./games-manager";
import { ProductsManager } from "./products-manager";
import { SubstoresManager } from "./substores-manager";
import { WhitelistManager } from "./whitelist-manager";
import type {
  GameRow,
  CatalogStoreRow,
  ProductRow,
  SubstoreRow,
  WhitelistRow,
} from "@/lib/data/admin-repository";

const actionMocks = vi.hoisted(() => ({
  archiveRecordAction: vi.fn(async () => ({ ok: true, message: "Registro arquivado." })),
  deleteProductAction: vi.fn(async (_productId: string) => {
    void _productId;
    return {
      ok: true,
      message: "Produto excluído definitivamente.",
    };
  }),
  deleteRecordPermanentlyAction: vi.fn(async () => ({
    ok: true,
    message: "Registro excluído definitivamente.",
  })),
  saveGameAction: vi.fn(async () => ({ ok: true, message: "Jogo salvo." })),
  saveProductOrderAction: vi.fn(async (_formData: FormData) => {
    void _formData;
    return { ok: true, message: "Ordem salva." };
  }),
  saveProductAction: vi.fn(async () => ({ ok: true, message: "Produto salvo." })),
  saveSubstoreAction: vi.fn(async () => ({ ok: true, message: "Subloja salva." })),
  saveWhitelistAction: vi.fn(async () => ({ ok: true, message: "Whitelist salva." })),
  routerReplace: vi.fn(),
}));

vi.mock("@/app/actions/admin", () => actionMocks);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: actionMocks.routerReplace }),
}));

const now = "2026-07-16T12:00:00.000Z";

const activeGame: GameRow = {
  id: "02c90c5b-6ea7-4508-b9da-79f39c10f314",
  name: "Counter-Strike 2",
  slug: "counter-strike-2",
  description: "Itens de CS2",
  image_url: null,
  status: "active",
  sort_order: 1,
  archived_at: null,
  created_at: now,
  updated_at: now,
};

const archivedGame: GameRow = {
  ...activeGame,
  id: "04aff6b6-38eb-4b6f-93f9-e687e17edbc6",
  name: "Valorant",
  slug: "valorant",
  description: "Catálogo antigo",
  status: "archived",
  archived_at: now,
  sort_order: 2,
};

const activeSubstore: SubstoreRow = {
  id: "338e5b0d-90e3-48aa-8f8e-aa090d777c64",
  game_id: activeGame.id,
  name: "Skins premium",
  slug: "skins-premium",
  title: "Skins premium de CS2",
  description: "Vitrine principal",
  color_hex: "#D4AF37",
  image_url: null,
  thumbnail_url: null,
  author_name: null,
  author_icon_url: null,
  footer_text: null,
  footer_icon_url: null,
  status: "active",
  sort_order: 1,
  archived_at: null,
  created_at: now,
  updated_at: now,
  games: { name: activeGame.name },
};

const activeProduct: ProductRow = {
  id: "7e8d6368-eb5a-4a52-b4f6-5e3d79b364ae",
  substore_id: activeSubstore.id,
  catalog_store_id: "5e8d6368-eb5a-4a52-b4f6-5e3d79b364ae",
  name: "AWP Asiimov",
  slug: "awp-asiimov",
  description: "Skin pronta para entrega",
  minimum_price_cents: 10_990,
  stock_quantity: 100,
  image_url: null,
  status: "active",
  sort_order: 1,
  low_stock_threshold: 5,
  archived_at: null,
  created_at: now,
  updated_at: now,
  catalog_stores: {
    name: "Loja principal",
    game_id: activeGame.id,
  },
  substores: { name: activeSubstore.name, games: { name: activeGame.name } },
};

const activeStore: CatalogStoreRow = {
  id: activeProduct.catalog_store_id,
  game_id: activeGame.id,
  name: "Loja principal",
  slug: "loja-principal",
  banner_url: null,
  status: "active",
  is_default: true,
  sort_order: 1,
  archived_at: null,
  created_at: now,
  updated_at: now,
  games: { name: activeGame.name },
};

const secondProduct: ProductRow = {
  ...activeProduct,
  id: "0d5a282b-e86e-488a-907a-d1ce9e7cdd14",
  name: "Dragon's Breath",
  slug: "dragons-breath",
  sort_order: 2,
};

const whitelistEntry: WhitelistRow = {
  id: "3edba8f3-d767-4852-9505-10f288f06ff5",
  discord_id: "123456789012345678",
  label: "Servidor principal",
  notes: "Responsável validado",
  is_active: true,
  commission_override_bps: 1_500,
  archived_at: null,
  created_at: now,
  updated_at: now,
};

describe("gestores do catálogo", () => {
  beforeEach(() => {
    Object.values(actionMocks).forEach((mock) => mock.mockClear());
  });

  afterEach(() => cleanup());

  it("abre o formulário de jogo e filtra por busca e estado", async () => {
    const user = userEvent.setup();
    render(
      <GamesManager
        games={[activeGame, archivedGame]}
        relatedCounts={{
          [activeGame.id]: { substores: 1, products: 1, totalSubstores: 1, totalProducts: 1 },
          [archivedGame.id]: { substores: 0, products: 0, totalSubstores: 0, totalProducts: 0 },
        }}
      />,
    );

    const table = screen.getByRole("table", { name: "Tabela de jogos" });
    expect(within(table).getByText(activeGame.name)).toBeInTheDocument();
    expect(within(table).getByText(archivedGame.name)).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Buscar em jogos" }), "valorant");
    expect(within(table).getByText(archivedGame.name)).toBeInTheDocument();
    expect(within(table).queryByText(activeGame.name)).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Buscar em jogos" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filtrar jogos por estado" }),
      "active",
    );
    expect(within(table).getByText(activeGame.name)).toBeInTheDocument();
    expect(within(table).queryByText(archivedGame.name)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Novo jogo" }));
    expect(screen.getByRole("heading", { name: "Novo jogo" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nome" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Slug" })).toHaveAttribute(
      "pattern",
      "[a-z0-9]+(?:-[a-z0-9]+)*",
    );
  });

  it("exige a dependência correta antes de criar sublojas e produtos", async () => {
    const user = userEvent.setup();
    const substoreView = render(
      <SubstoresManager games={[]} substores={[]} productCounts={{}} totalProductCounts={{}} />,
    );
    expect(screen.getByRole("button", { name: "Nova categoria" })).toBeDisabled();
    substoreView.unmount();

    const productView = render(
      <ProductsManager products={[]} substores={[]} stores={[]} />,
    );
    expect(screen.getByRole("button", { name: "Novo produto" })).toBeDisabled();
    productView.unmount();

    const enabledSubstoreView = render(
      <SubstoresManager
        games={[activeGame]}
        substores={[]}
        productCounts={{}}
        totalProductCounts={{}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Nova categoria" }));
    expect(screen.getByRole("heading", { name: "Nova categoria" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Jogo" })).toHaveValue(activeGame.id);
    expect(screen.getByLabelText("Imagem principal")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
    enabledSubstoreView.unmount();

    render(
      <ProductsManager
        products={[activeProduct]}
        substores={[activeSubstore]}
        stores={[activeStore]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Novo produto" }));
    expect(screen.getByRole("heading", { name: "Novo produto" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "1. Categoria" })).toHaveValue(activeSubstore.id);
    expect(screen.getByRole("combobox", { name: "2. Loja/mundo desta vitrine" })).toHaveValue(activeStore.id);
    expect(screen.queryByRole("textbox", { name: "Slug" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Preço mínimo" })).toBeRequired();
    expect(screen.getByRole("spinbutton", { name: "Estoque disponível" })).toHaveValue(0);
  });

  it("preserva a loja filtrada e abre o novo produto no mesmo jogo", async () => {
    const user = userEvent.setup();
    const secondGameId = "66db4c6d-0107-49db-8996-b95b1d509ca4";
    const secondSubstore: SubstoreRow = {
      ...activeSubstore,
      id: "89a9930b-e6ba-4a2e-ae58-fd0450d8bb0e",
      game_id: secondGameId,
      name: "Itens do jogo 2",
      games: { name: "Jogo 2" },
    };
    const secondStore: CatalogStoreRow = {
      ...activeStore,
      id: "af5f0e56-dd25-46e2-b7e6-8495ce890e4c",
      game_id: secondGameId,
      name: "Mundo 2",
      games: { name: "Jogo 2" },
    };
    const secondGameProduct: ProductRow = {
      ...secondProduct,
      substore_id: secondSubstore.id,
      catalog_store_id: secondStore.id,
      catalog_stores: { name: secondStore.name, game_id: secondGameId },
      substores: { name: secondSubstore.name, games: { name: "Jogo 2" } },
    };

    render(
      <ProductsManager
        products={[activeProduct, secondGameProduct]}
        substores={[activeSubstore, secondSubstore]}
        stores={[activeStore, secondStore]}
        initialStoreId={secondStore.id}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Filtrar produtos por loja ou mundo" })).toHaveValue(
      secondStore.id,
    );
    expect(screen.getByText(secondGameProduct.name)).toBeInTheDocument();
    expect(screen.queryByText(activeProduct.name)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Novo produto" }));
    expect(screen.getByRole("combobox", { name: "1. Categoria" })).toHaveValue(secondSubstore.id);
    expect(screen.getByRole("combobox", { name: "2. Loja/mundo desta vitrine" })).toHaveValue(
      secondStore.id,
    );
  });

  it("edita o estoque agregado dentro do próprio produto", async () => {
    const user = userEvent.setup();
    render(<ProductsManager products={[activeProduct]} substores={[activeSubstore]} stores={[activeStore]} />);

    expect(screen.getByRole("cell", { name: "100" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByRole("spinbutton", { name: "Estoque disponível" })).toHaveValue(100);
    expect(screen.getByRole("spinbutton", { name: "Estoque disponível" })).toHaveAttribute(
      "max",
      "1000000000",
    );
  });

  it("confirma a exclusão definitiva de produto sem estoque", async () => {
    const user = userEvent.setup();
    const unusedProduct = { ...activeProduct, stock_quantity: 0 };
    render(<ProductsManager products={[unusedProduct]} substores={[activeSubstore]} stores={[activeStore]} />);

    await user.click(
      screen.getByRole("button", { name: `Excluir definitivamente ${unusedProduct.name}` }),
    );
    expect(
      screen.getByRole("heading", { name: "Excluir produto definitivamente" }),
    ).toBeInTheDocument();
    expect(actionMocks.deleteProductAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => {
      expect(actionMocks.deleteProductAction).toHaveBeenCalledWith(unusedProduct.id);
    });
    expect(await screen.findByText("Produto excluído definitivamente.")).toBeInTheDocument();
  });

  it("exige estoque zerado antes da exclusão definitiva", async () => {
    const user = userEvent.setup();
    render(<ProductsManager products={[activeProduct]} substores={[activeSubstore]} stores={[activeStore]} />);

    await user.click(
      screen.getByRole("button", { name: `Excluir definitivamente ${activeProduct.name}` }),
    );
    expect(screen.getByText(/Zere o estoque atual de 100 unidade/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir definitivamente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Arquivar produto" })).toBeEnabled();
  });

  it("reordena produtos pelo controle e só publica depois de salvar", async () => {
    const user = userEvent.setup();
    render(
      <ProductsManager
        products={[activeProduct, secondProduct]}
        substores={[activeSubstore]}
        stores={[activeStore]}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "Salvar ordem" });
    expect(saveButton).toBeDisabled();

    const secondHandle = screen.getByRole("button", { name: `Mover ${secondProduct.name}` });
    await user.click(secondHandle);
    await user.keyboard("{ArrowUp}");

    const handles = screen.getAllByRole("button", { name: /^Mover / });
    expect(handles[0]).toHaveAccessibleName(`Mover ${secondProduct.name}`);
    expect(saveButton).toBeEnabled();
    expect(actionMocks.saveProductOrderAction).not.toHaveBeenCalled();

    await user.click(saveButton);
    await waitFor(() => expect(actionMocks.saveProductOrderAction).toHaveBeenCalledOnce());

    const formData = actionMocks.saveProductOrderAction.mock.calls[0]?.[0] as FormData;
    expect(JSON.parse(String(formData.get("productIds")))).toEqual([
      secondProduct.id,
      activeProduct.id,
    ]);
    expect(await screen.findByText("Ordem salva.")).toBeInTheDocument();
  });

  it("edita uma whitelist preservando Discord ID e exceção de comissão", async () => {
    const user = userEvent.setup();
    render(
      <WhitelistManager
        entries={[whitelistEntry]}
        globalCommissionBps={3_000}
        guildCounts={{ [whitelistEntry.id]: 2 }}
      />,
    );

    expect(screen.getByText("15%")).toBeInTheDocument();
    expect(screen.getByText("Exceção")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByRole("heading", { name: "Editar whitelist" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Discord ID" })).toHaveValue(
      whitelistEntry.discord_id,
    );
    expect(screen.getByRole("textbox", { name: "Exceção de comissão" })).toHaveValue("15");
    expect(screen.getByRole("checkbox", { name: /Autorização ativa/ })).toBeChecked();
  });

  it("pede confirmação antes de arquivar e chama a ação com alvo e UUID", async () => {
    const user = userEvent.setup();
    render(
      <GamesManager
        games={[activeGame]}
        relatedCounts={{
          [activeGame.id]: {
            substores: 1,
            products: 1,
            totalSubstores: 1,
            totalProducts: 1,
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: `Arquivar ${activeGame.name}` }));
    expect(screen.getByRole("heading", { name: "Arquivar jogo" })).toBeInTheDocument();
    expect(actionMocks.archiveRecordAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirmar arquivamento" }));
    await waitFor(() => {
      expect(actionMocks.archiveRecordAction).toHaveBeenCalledWith("game", activeGame.id);
    });
    expect(await screen.findByText("Registro arquivado.")).toBeInTheDocument();
  });

  it("exclui definitivamente um jogo sem categorias nem produtos", async () => {
    const user = userEvent.setup();
    render(
      <GamesManager
        games={[activeGame]}
        relatedCounts={{
          [activeGame.id]: {
            substores: 0,
            products: 0,
            totalSubstores: 0,
            totalProducts: 0,
          },
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: `Excluir definitivamente ${activeGame.name}` }),
    );
    expect(screen.getByRole("heading", { name: "Excluir jogo definitivamente" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Excluir definitivamente" }));

    await waitFor(() => {
      expect(actionMocks.deleteRecordPermanentlyAction).toHaveBeenCalledWith("game", activeGame.id);
    });
  });
});
