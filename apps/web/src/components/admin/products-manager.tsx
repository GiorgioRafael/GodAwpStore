"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { useActionState, useId, useMemo, useRef, useState, useTransition } from "react";
import { Archive, LoaderCircle, Menu, PackageOpen, Pencil, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  saveProductAction,
  saveProductOrderAction,
} from "@/app/actions/admin";
import { ActionFeedback, fieldError, initialAdminActionState } from "@/components/admin/action-feedback";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { formatCentsForInput, formatMoney } from "@/components/admin/admin-format";
import { ArchiveDialog } from "@/components/admin/archive-dialog";
import { CatalogStatusBadge, editableCatalogStatuses } from "@/components/admin/catalog-status";
import { DeleteRecordDialog } from "@/components/admin/delete-record-dialog";
import { MediaThumbnail } from "@/components/admin/media-thumbnail";
import { MediaUploadField } from "@/components/admin/media-upload-field";
import {
  catalogStatusOptions,
  ResourceManagerShell,
} from "@/components/admin/resource-manager-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/form-field";
import type { CatalogStoreRow, ProductRow, SubstoreRow } from "@/lib/data/admin-repository";

interface ProductsManagerProps {
  products: ProductRow[];
  substores: SubstoreRow[];
  stores: CatalogStoreRow[];
  initialStoreId?: string;
}

function ProductForm({
  product,
  substores,
  stores,
  preferredStoreId,
  nextSortOrder,
  onClose,
}: {
  product: ProductRow | null;
  substores: SubstoreRow[];
  stores: CatalogStoreRow[];
  preferredStoreId: string | null;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveProductAction, initialAdminActionState);
  const formId = useId();
  const selectableSubstores = substores.filter(
    (substore) => substore.status !== "archived" || substore.id === product?.substore_id,
  );
  const preferredStore = product
    ? null
    : stores.find(
        (store) =>
          store.id === preferredStoreId &&
          store.status === "active" &&
          !store.archived_at,
      ) ?? null;
  const initialSubstoreId =
    product?.substore_id ??
    selectableSubstores.find((substore) => substore.game_id === preferredStore?.game_id)?.id ??
    selectableSubstores[0]?.id ??
    "";
  const [selectedSubstoreId, setSelectedSubstoreId] = useState(initialSubstoreId);
  const selectedSubstore = selectableSubstores.find(
    (substore) => substore.id === selectedSubstoreId,
  ) ?? null;
  const selectableStores = stores.filter(
    (store) =>
      store.game_id === selectedSubstore?.game_id &&
      store.status === "active" &&
      !store.archived_at,
  );
  const initialStoreId =
    product?.catalog_store_id && selectableStores.some((store) => store.id === product.catalog_store_id)
      ? product.catalog_store_id
      : preferredStore && selectableStores.some((store) => store.id === preferredStore.id)
        ? preferredStore.id
      : selectableStores.find((store) => store.is_default)?.id ?? selectableStores[0]?.id ?? "";
  const [selectedCatalogStoreId, setSelectedCatalogStoreId] = useState(initialStoreId);

  function selectSubstore(substoreId: string) {
    const substore = selectableSubstores.find((candidate) => candidate.id === substoreId) ?? null;
    const nextStores = stores.filter(
      (store) => store.game_id === substore?.game_id && store.status === "active" && !store.archived_at,
    );
    setSelectedSubstoreId(substoreId);
    setSelectedCatalogStoreId(
      nextStores.find((store) => store.is_default)?.id ?? nextStores[0]?.id ?? "",
    );
  }

  return (
    <AdminDialog
      open
      onClose={onClose}
      size="lg"
      title={product ? "Editar produto" : "Novo produto"}
      description="Escolha primeiro a categoria e a loja/mundo. Assim o item já aparece na vitrine certa do Discord."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {pending ? "Salvando..." : "Salvar produto"}
          </Button>
        </>
      }
    >
      <form id={formId} action={formAction} className="space-y-5">
        <input type="hidden" name="id" value={product?.id ?? ""} />
        <input type="hidden" name="updatedAt" value={product?.updated_at ?? ""} />
        <input type="hidden" name="sortOrder" value={product?.sort_order ?? nextSortOrder} />
        <ActionFeedback state={state} />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="1. Categoria" htmlFor={`${formId}-substore`} error={fieldError(state, "substoreId")}>
          <Select
            id={`${formId}-substore`}
            name="substoreId"
            value={selectedSubstoreId}
            onChange={(event) => selectSubstore(event.target.value)}
            required
          >
            <option value="" disabled>Selecione uma categoria</option>
            {selectableSubstores.map((substore) => (
              <option key={substore.id} value={substore.id}>
                {substore.games?.name ? `${substore.games.name} — ` : ""}{substore.name}
                {substore.status === "archived" ? " (arquivada)" : ""}
              </option>
            ))}
          </Select>
          </Field>
          <Field
            label="2. Loja/mundo desta vitrine"
            htmlFor={`${formId}-catalog-store`}
            hint="O item só aparece nesta loja"
            error={fieldError(state, "catalogStoreId")}
          >
            <Select
              id={`${formId}-catalog-store`}
              name="catalogStoreId"
              value={selectedCatalogStoreId}
              onChange={(event) => setSelectedCatalogStoreId(event.target.value)}
              disabled={selectableStores.length === 0}
              required
            >
              <option value="" disabled>
                {selectedSubstore ? "Nenhuma loja disponível para esta categoria" : "Selecione uma categoria"}
              </option>
              {selectableStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}{store.is_default ? " (principal)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Nome" htmlFor={`${formId}-name`} error={fieldError(state, "name")}>
          <Input
            id={`${formId}-name`}
            name="name"
            defaultValue={product?.name ?? ""}
            maxLength={160}
            required
            autoFocus
            autoComplete="off"
          />
        </Field>

        <Field
          label="Descrição"
          htmlFor={`${formId}-description`}
          hint="Opcional"
          error={fieldError(state, "description")}
        >
          <Textarea
            id={`${formId}-description`}
            name="description"
            defaultValue={product?.description ?? ""}
            maxLength={4_096}
          />
        </Field>

        <MediaUploadField
          name="imageUrl"
          label="Foto exibida no Discord"
          folder="products"
          initialValue={product?.image_url}
          error={fieldError(state, "imageUrl")}
          hint="Prefira uma imagem quadrada. JPG, PNG ou WebP de até 5 MB."
        />

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Preço mínimo"
            htmlFor={`${formId}-price`}
            hint="BRL"
            error={fieldError(state, "minimumPrice") ?? fieldError(state, "minimumPriceCents")}
          >
            <Input
              id={`${formId}-price`}
              name="minimumPrice"
              inputMode="decimal"
              placeholder="10,00"
              defaultValue={product ? formatCentsForInput(product.minimum_price_cents) : ""}
              pattern="[0-9]+(?:\.[0-9]{3})*(?:,[0-9]{1,2})?"
              required
            />
          </Field>
          <Field
            label="Estoque disponível"
            htmlFor={`${formId}-stock`}
            hint="unidades"
            error={fieldError(state, "stockQuantity")}
          >
            <Input
              id={`${formId}-stock`}
              name="stockQuantity"
              type="number"
              inputMode="numeric"
              min={0}
              max={1_000_000_000}
              step={1}
              defaultValue={product?.stock_quantity ?? 0}
              required
            />
          </Field>
          <Field label="Alerta baixo" htmlFor={`${formId}-low-stock`} error={fieldError(state, "lowStockThreshold")}>
            <Input
              id={`${formId}-low-stock`}
              name="lowStockThreshold"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={product?.low_stock_threshold ?? 5}
              required
            />
          </Field>
          <Field label="Estado" htmlFor={`${formId}-status`} error={fieldError(state, "status")}>
            <Select id={`${formId}-status`} name="status" defaultValue={product?.status ?? "active"}>
              {editableCatalogStatuses.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </form>
    </AdminDialog>
  );
}

export function ProductsManager({
  products,
  substores,
  stores,
  initialStoreId = "all",
}: ProductsManagerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState(initialStoreId);
  const [orderedProducts, setOrderedProducts] = useState(products);
  const [orderDirty, setOrderDirty] = useState(false);
  const [orderState, setOrderState] = useState(initialAdminActionState);
  const [orderPending, startOrderTransition] = useTransition();
  const [draggingProductId, setDraggingProductId] = useState<string | null>(null);
  const draggingProductIdRef = useRef<string | null>(null);
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "edit"; product: ProductRow } | null
  >(null);
  const [archiveRecord, setArchiveRecord] = useState<{ id: string; label: string } | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<{
    id: string;
    label: string;
    blockedReason: string | null;
  } | null>(null);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return orderedProducts.filter((product) => {
      const matchesFilter = filter === "all" || product.status === filter;
      const matchesStore = storeFilter === "all" || product.catalog_store_id === storeFilter;
      const matchesSearch =
        !query ||
        product.name.toLocaleLowerCase("pt-BR").includes(query) ||
        product.slug.toLocaleLowerCase("pt-BR").includes(query) ||
        product.substores?.name.toLocaleLowerCase("pt-BR").includes(query) ||
        product.substores?.games?.name.toLocaleLowerCase("pt-BR").includes(query);
      return matchesFilter && matchesStore && Boolean(matchesSearch);
    });
  }, [filter, orderedProducts, search, storeFilter]);

  const editingProduct = editor?.mode === "edit" ? editor.product : null;
  const hasAvailableSubstore = substores.some((substore) => substore.status !== "archived");
  const hasAvailableStore = stores.some((store) => store.status === "active" && !store.archived_at);
  const filtersActive = Boolean(search.trim()) || filter !== "all" || storeFilter !== "all";
  const canReorder = !filtersActive && orderedProducts.length > 1 && !orderPending;
  const nextSortOrder = orderedProducts.reduce(
    (highest, product) => Math.max(highest, product.sort_order),
    -1,
  ) + 1;

  function moveProduct(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;

    setOrderedProducts((currentProducts) => {
      const sourceIndex = currentProducts.findIndex((product) => product.id === draggedId);
      const targetIndex = currentProducts.findIndex((product) => product.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return currentProducts;

      const nextProducts = [...currentProducts];
      const [movedProduct] = nextProducts.splice(sourceIndex, 1);
      if (!movedProduct) return currentProducts;
      nextProducts.splice(targetIndex, 0, movedProduct);
      return nextProducts;
    });
    setOrderDirty(true);
    setOrderState(initialAdminActionState);
  }

  function moveProductWithKeyboard(productId: string, direction: -1 | 1) {
    const currentIndex = orderedProducts.findIndex((product) => product.id === productId);
    const targetProduct = orderedProducts[currentIndex + direction];
    if (!targetProduct) return;
    moveProduct(productId, targetProduct.id);
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, productId: string) {
    draggingProductIdRef.current = productId;
    setDraggingProductId(productId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", productId);
  }

  function finishDragging() {
    draggingProductIdRef.current = null;
    setDraggingProductId(null);
  }

  function handleOrderKeyDown(event: KeyboardEvent<HTMLButtonElement>, productId: string) {
    if (!canReorder || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    moveProductWithKeyboard(productId, event.key === "ArrowUp" ? -1 : 1);
  }

  function saveOrder() {
    const formData = new FormData();
    formData.set("productIds", JSON.stringify(orderedProducts.map((product) => product.id)));
    startOrderTransition(async () => {
      const result = await saveProductOrderAction(formData);
      setOrderState(result);
      if (result.ok) setOrderDirty(false);
    });
  }

  function selectStoreFilter(storeId: string) {
    setStoreFilter(storeId);
    router.replace(
      storeId === "all"
        ? "/catalogo/produtos"
        : `/catalogo/produtos?loja=${encodeURIComponent(storeId)}`,
      { scroll: false },
    );
  }

  return (
    <>
      <ResourceManagerShell
        eyebrow="Catálogo"
        title="Produtos"
        description="Cada produto pertence a uma loja/mundo. Escolha a loja ao cadastrar ou mova vários itens juntos em Estoque por loja."
        actionLabel="Novo produto"
        onCreate={() => setEditor({ mode: "create" })}
        additionalActions={
          <Button
            variant={orderDirty ? "primary" : "secondary"}
            onClick={saveOrder}
            disabled={!orderDirty || orderPending}
          >
            {orderPending ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="size-4" />
            )}
            {orderPending ? "Salvando ordem..." : "Salvar ordem"}
          </Button>
        }
        createDisabled={!hasAvailableSubstore || !hasAvailableStore}
        createDisabledReason={
          !hasAvailableSubstore
            ? "Crie ou reative uma categoria antes de cadastrar um produto."
            : "Crie ou reative uma loja/mundo antes de cadastrar um produto."
        }
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        filterOptions={catalogStatusOptions}
        extraFilters={
          <Select
            aria-label="Filtrar produtos por loja ou mundo"
            className="sm:w-56"
            value={storeFilter}
            onChange={(event) => selectStoreFilter(event.target.value)}
          >
            <option value="all">Todas as lojas/mundos</option>
            {stores
              .filter((store) => store.status === "active" && !store.archived_at)
              .map((store) => (
                <option key={store.id} value={store.id}>
                  {store.games?.name ? `${store.games.name} — ` : ""}{store.name}
                </option>
              ))}
          </Select>
        }
        extraFiltersActive={storeFilter !== "all"}
        columns={["Produto", "Loja/mundo", "Categoria", "Preço mínimo", "Disponível", "Alerta", "Status", "Ações"]}
        totalCount={products.length}
        visibleCount={filteredProducts.length}
        emptyIcon={PackageOpen}
        emptyTitle="Nenhum produto cadastrado"
        emptyDescription="Cadastre um jogo e uma categoria antes de incluir o primeiro produto."
        contextualContent={
          <div className="space-y-3">
            <div
              id="product-order-instructions"
              className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between"
            >
              <span>Arraste pelo ícone de três linhas ou use as setas ↑ e ↓. As vitrines publicadas são atualizadas ao salvar.</span>
              {filtersActive ? (
                <span className="text-xs text-gold">Limpe a busca e os filtros para reordenar.</span>
              ) : null}
            </div>
            <ActionFeedback state={orderState} />
          </div>
        }
      >
        {filteredProducts.map((product) => {
          const available = product.stock_quantity;
          const isLowStock = product.status === "active" && available <= product.low_stock_threshold;

          return (
            <tr
              key={product.id}
              onDragEnter={(event: DragEvent<HTMLTableRowElement>) => {
                if (!canReorder || !draggingProductIdRef.current) return;
                event.preventDefault();
                moveProduct(draggingProductIdRef.current, product.id);
              }}
              onDragOver={(event: DragEvent<HTMLTableRowElement>) => {
                if (!canReorder) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event: DragEvent<HTMLTableRowElement>) => {
                event.preventDefault();
                finishDragging();
              }}
              className={cn(
                "border-b border-border/80 transition-colors last:border-0",
                draggingProductId === product.id && "bg-gold/[0.04] opacity-60",
              )}
            >
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <MediaThumbnail src={product.image_url} alt="" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{product.name}</p>
                    <p className="mt-1 max-w-64 truncate text-xs text-muted">/{product.slug}</p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-4">
                <p className="text-sm font-medium text-muted-strong">{product.catalog_stores?.name ?? "Loja não definida"}</p>
                {product.substores?.games?.name ? <p className="mt-1 text-xs text-muted">{product.substores.games.name}</p> : null}
              </td>
              <td className="px-5 py-4">
                <p className="text-sm text-muted-strong">{product.substores?.name ?? "Categoria removida"}</p>
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-sm font-medium text-foreground">{formatMoney(product.minimum_price_cents)}</td>
              <td className="px-5 py-4 text-sm font-medium text-foreground">{available.toLocaleString("pt-BR")}</td>
              <td className="px-5 py-4">
                <Badge tone={isLowStock ? "warning" : "neutral"}>
                  {available}/{product.low_stock_threshold}
                </Badge>
              </td>
              <td className="px-5 py-4"><CatalogStatusBadge status={product.status} /></td>
              <td className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditor({ mode: "edit", product })}>
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    aria-label={`Arquivar ${product.name}`}
                    title={product.status === "archived" ? "Produto já arquivado" : "Arquivar produto"}
                    disabled={product.status === "archived"}
                    onClick={() => setArchiveRecord({ id: product.id, label: product.name })}
                  >
                    <Archive aria-hidden="true" className="size-4" />
                    Arquivar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    aria-label={`Excluir definitivamente ${product.name}`}
                    title="Excluir produto definitivamente"
                    onClick={() => setDeleteRecord({
                      id: product.id,
                      label: product.name,
                      blockedReason: product.stock_quantity > 0
                        ? `Zere o estoque atual de ${product.stock_quantity.toLocaleString("pt-BR")} unidade(s) antes de excluir.`
                        : null,
                    })}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    Excluir
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 cursor-grab text-muted active:cursor-grabbing"
                    aria-label={`Mover ${product.name}`}
                    aria-describedby="product-order-instructions"
                    title={filtersActive ? "Limpe a busca e os filtros para reordenar" : "Arrastar para reordenar"}
                    draggable={canReorder}
                    disabled={!canReorder}
                    onDragStart={(event) => handleDragStart(event, product.id)}
                    onDragEnd={finishDragging}
                    onKeyDown={(event) => handleOrderKeyDown(event, product.id)}
                  >
                    <Menu aria-hidden="true" className="size-5" />
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </ResourceManagerShell>

      {editor ? (
        <ProductForm
          key={editingProduct?.id ?? "new-product"}
          product={editingProduct}
          substores={substores}
          stores={stores}
          preferredStoreId={storeFilter === "all" ? null : storeFilter}
          nextSortOrder={nextSortOrder}
          onClose={() => setEditor(null)}
        />
      ) : null}
      <ArchiveDialog
        key={archiveRecord?.id ?? "archive-product"}
        target="product"
        record={archiveRecord}
        noun="produto"
        onClose={() => setArchiveRecord(null)}
      />
      <DeleteRecordDialog
        key={deleteRecord?.id ?? "delete-product"}
        target="product"
        record={deleteRecord}
        noun="produto"
        description="Use esta opção somente para produtos sem estoque, pedidos, sorteios, ofertas ou histórico da roleta."
        onClose={() => setDeleteRecord(null)}
        onArchive={(record) => {
          setDeleteRecord(null);
          setArchiveRecord({ id: record.id, label: record.label });
        }}
      />
    </>
  );
}
