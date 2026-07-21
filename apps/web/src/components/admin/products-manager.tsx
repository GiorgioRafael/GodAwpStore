"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Archive, LoaderCircle, PackageOpen, Pencil } from "lucide-react";

import { saveProductAction } from "@/app/actions/admin";
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
import { Field, Input, Select, Textarea } from "@/components/ui/form-field";
import type { ProductRow, SubstoreRow } from "@/lib/data/admin-repository";

interface ProductsManagerProps {
  products: ProductRow[];
  substores: SubstoreRow[];
}

function ProductForm({
  product,
  substores,
  onClose,
}: {
  product: ProductRow | null;
  substores: SubstoreRow[];
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

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
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
          <Field label="Ordem" htmlFor={`${formId}-sort-order`} error={fieldError(state, "sortOrder")}>
            <Input
              id={`${formId}-sort-order`}
              name="sortOrder"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={product?.sort_order ?? 0}
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
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "edit"; product: ProductRow } | null
  >(null);
  const [archiveRecord, setArchiveRecord] = useState<{ id: string; label: string } | null>(null);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return products.filter((product) => {
      const matchesFilter = filter === "all" || product.status === filter;
      const matchesSearch =
        !query ||
        product.name.toLocaleLowerCase("pt-BR").includes(query) ||
        product.slug.toLocaleLowerCase("pt-BR").includes(query) ||
        product.substores?.name.toLocaleLowerCase("pt-BR").includes(query) ||
        product.substores?.games?.name.toLocaleLowerCase("pt-BR").includes(query);
      return matchesFilter && Boolean(matchesSearch);
    });
  }, [filter, products, search]);

  const editingProduct = editor?.mode === "edit" ? editor.product : null;
  const hasAvailableSubstore = substores.some((substore) => substore.status !== "archived");

  return (
    <>
      <ResourceManagerShell
        eyebrow="Catálogo"
        title="Produtos"
        description="Gerencie produto, preço e estoque agregado. Ao salvar, a vitrine publicada no Discord é atualizada."
        actionLabel="Novo produto"
        onCreate={() => setEditor({ mode: "create" })}
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
      >
        {filteredProducts.map((product) => {
          const available = product.stock_quantity;
          const isLowStock = product.status === "active" && available <= product.low_stock_threshold;

          return (
            <tr key={product.id} className="border-b border-border/80 last:border-0">
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
