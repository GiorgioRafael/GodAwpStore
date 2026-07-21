"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { useActionState, useId, useMemo, useRef, useState, useTransition } from "react";
import { Archive, LoaderCircle, Menu, PackageOpen, Pencil, Save } from "lucide-react";

import { saveProductAction, saveProductOrderAction } from "@/app/actions/admin";
import { ActionFeedback, fieldError, initialAdminActionState } from "@/components/admin/action-feedback";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { formatCentsForInput, formatMoney } from "@/components/admin/admin-format";
import { ArchiveDialog } from "@/components/admin/archive-dialog";
import { CatalogStatusBadge, editableCatalogStatuses } from "@/components/admin/catalog-status";
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
import type { ProductRow, SubstoreRow } from "@/lib/data/admin-repository";

interface ProductsManagerProps {
  products: ProductRow[];
  substores: SubstoreRow[];
}

function ProductForm({
  product,
  substores,
  nextSortOrder,
  onClose,
}: {
  product: ProductRow | null;
  substores: SubstoreRow[];
  nextSortOrder: number;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveProductAction, initialAdminActionState);
  const formId = useId();
  const selectableSubstores = substores.filter(
    (substore) => substore.status !== "archived" || substore.id === product?.substore_id,
  );

  return (
    <AdminDialog
      open
      onClose={onClose}
      size="lg"
      title={product ? "Editar produto" : "Novo produto"}
      description="Cadastre o item, a foto exibida no Discord, o preço e a quantidade disponível."
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

        <Field label="Subloja" htmlFor={`${formId}-substore`} error={fieldError(state, "substoreId")}>
          <Select
            id={`${formId}-substore`}
            name="substoreId"
            defaultValue={product?.substore_id ?? selectableSubstores[0]?.id ?? ""}
            required
          >
            <option value="" disabled>Selecione uma subloja</option>
            {selectableSubstores.map((substore) => (
              <option key={substore.id} value={substore.id}>
                {substore.games?.name ? `${substore.games.name} — ` : ""}{substore.name}
                {substore.status === "archived" ? " (arquivada)" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
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
            label="Slug"
            htmlFor={`${formId}-slug`}
            hint="letras, números e hífens"
            error={fieldError(state, "slug")}
          >
            <Input
              id={`${formId}-slug`}
              name="slug"
              defaultValue={product?.slug ?? ""}
              maxLength={80}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
              autoComplete="off"
            />
          </Field>
        </div>

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

export function ProductsManager({ products, substores }: ProductsManagerProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
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

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return orderedProducts.filter((product) => {
      const matchesFilter = filter === "all" || product.status === filter;
      const matchesSearch =
        !query ||
        product.name.toLocaleLowerCase("pt-BR").includes(query) ||
        product.slug.toLocaleLowerCase("pt-BR").includes(query) ||
        product.substores?.name.toLocaleLowerCase("pt-BR").includes(query) ||
        product.substores?.games?.name.toLocaleLowerCase("pt-BR").includes(query);
      return matchesFilter && Boolean(matchesSearch);
    });
  }, [filter, orderedProducts, search]);

  const editingProduct = editor?.mode === "edit" ? editor.product : null;
  const hasAvailableSubstore = substores.some((substore) => substore.status !== "archived");
  const filtersActive = Boolean(search.trim()) || filter !== "all";
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

  return (
    <>
      <ResourceManagerShell
        eyebrow="Catálogo"
        title="Produtos"
        description="Gerencie produto, preço e estoque agregado. Ao salvar, a vitrine publicada no Discord é atualizada."
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
        createDisabled={!hasAvailableSubstore}
        createDisabledReason="Crie ou reative uma subloja antes de cadastrar um produto."
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        filterOptions={catalogStatusOptions}
        columns={["Produto", "Subloja", "Preço mínimo", "Disponível", "Alerta", "Status", "Ações"]}
        totalCount={products.length}
        visibleCount={filteredProducts.length}
        emptyIcon={PackageOpen}
        emptyTitle="Nenhum produto cadastrado"
        emptyDescription="Cadastre jogos e sublojas antes de incluir o primeiro produto no catálogo."
        contextualContent={
          <div className="space-y-3">
            <div
              id="product-order-instructions"
              className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between"
            >
              <span>Arraste pelo ícone de três linhas ou use as setas ↑ e ↓. A vitrine só muda ao salvar.</span>
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
                <p className="text-sm text-muted-strong">{product.substores?.name ?? "Subloja removida"}</p>
                {product.substores?.games?.name ? <p className="mt-1 text-xs text-muted">{product.substores.games.name}</p> : null}
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
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditor({ mode: "edit", product })}>
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-danger"
                    aria-label={`Arquivar ${product.name}`}
                    title={product.status === "archived" ? "Produto já arquivado" : "Arquivar produto"}
                    disabled={product.status === "archived"}
                    onClick={() => setArchiveRecord({ id: product.id, label: product.name })}
                  >
                    <Archive aria-hidden="true" className="size-4" />
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
    </>
  );
}
