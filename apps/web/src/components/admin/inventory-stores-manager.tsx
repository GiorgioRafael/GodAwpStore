"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowRightLeft, Folder, FolderOpen, LoaderCircle, PackageOpen } from "lucide-react";

import { moveCatalogProductsAction } from "@/app/actions/admin";
import { ActionFeedback, initialAdminActionState } from "@/components/admin/action-feedback";
import { MediaThumbnail } from "@/components/admin/media-thumbnail";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form-field";
import type { CatalogStoreRow, ProductRow } from "@/lib/data/admin-repository";

export function InventoryStoresManager({
  stores,
  products,
  initialStoreId,
}: {
  stores: CatalogStoreRow[];
  products: ProductRow[];
  initialStoreId?: string;
}) {
  const activeStores = useMemo(
    () => stores.filter((store) => store.status === "active" && !store.archived_at),
    [stores],
  );
  const initialStore =
    activeStores.find((store) => store.id === initialStoreId) ??
    activeStores.find((store) => store.is_default) ??
    activeStores[0] ??
    null;
  const [selectedStoreId, setSelectedStoreId] = useState(
    initialStore?.id ?? "",
  );
  const [inventoryProducts, setInventoryProducts] = useState(products);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [targetStoreId, setTargetStoreId] = useState(
    activeStores.find(
      (store) => store.game_id === initialStore?.game_id && store.id !== initialStore?.id,
    )?.id ?? "",
  );
  const [state, setState] = useState(initialAdminActionState);
  const [pending, startTransition] = useTransition();
  const selectedStore = activeStores.find((store) => store.id === selectedStoreId) ?? null;
  const visibleProducts = inventoryProducts.filter(
    (product) => product.catalog_store_id === selectedStoreId && !product.archived_at,
  );
  const targetStores = activeStores.filter(
    (store) => store.game_id === selectedStore?.game_id && store.id !== selectedStoreId,
  );

  function selectStore(storeId: string) {
    const store = activeStores.find((candidate) => candidate.id === storeId) ?? null;
    setSelectedStoreId(storeId);
    setSelectedProductIds([]);
    setTargetStoreId(
      activeStores.find(
        (candidate) => candidate.game_id === store?.game_id && candidate.id !== storeId,
      )?.id ?? "",
    );
    setState(initialAdminActionState);
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  function toggleAllVisibleProducts() {
    const visibleIds = visibleProducts.map((product) => product.id);
    const everyVisibleProductIsSelected =
      visibleIds.length > 0 && visibleIds.every((productId) => selectedProductIds.includes(productId));
    setSelectedProductIds(everyVisibleProductIsSelected ? [] : visibleIds);
  }

  function moveProducts() {
    const productsToMove = [...selectedProductIds];
    const targetStore = activeStores.find((store) => store.id === targetStoreId) ?? null;
    if (productsToMove.length === 0 || !targetStore) return;
    const formData = new FormData();
    formData.set("productIds", JSON.stringify(productsToMove));
    formData.set("targetStoreId", targetStoreId);
    startTransition(async () => {
      const result = await moveCatalogProductsAction(formData);
      setState(result);
      if (result.ok) {
        setInventoryProducts((current) =>
          current.map((product) =>
            productsToMove.includes(product.id)
              ? {
                  ...product,
                  catalog_store_id: targetStore.id,
                  catalog_stores: { name: targetStore.name, game_id: targetStore.game_id },
                }
              : product,
          ),
        );
        setSelectedProductIds([]);
      }
    });
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Operação"
        title="Estoque por loja"
        description="Organize cada vitrine sem risco: escolha a loja de origem, marque os produtos e mova para outra loja do mesmo jogo."
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Pastas de estoque</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                1. Escolha a loja de origem. 2. Marque os produtos. 3. Escolha a loja de destino e mova.
              </p>
            </div>
            <span className="grid size-10 place-items-center rounded-xl border border-gold/20 bg-gold/[0.06] text-gold">
              <FolderOpen aria-hidden="true" className="size-[18px]" />
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {activeStores.map((store) => {
              const count = inventoryProducts.filter(
                (product) => product.catalog_store_id === store.id && !product.archived_at,
              ).length;
              const selected = store.id === selectedStoreId;
              return (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => selectStore(store.id)}
                  aria-pressed={selected}
                  className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-gold/40 bg-gold/[0.08]"
                      : "border-border bg-surface-muted hover:border-gold/25"
                  }`}
                >
                  {selected ? <FolderOpen className="mt-0.5 size-5 shrink-0 text-gold" /> : <Folder className="mt-0.5 size-5 shrink-0 text-muted" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{store.name}</span>
                    <span className="mt-1 block text-xs text-muted">{store.games?.name ?? "Jogo"} · {count} produto(s)</span>
                  </span>
                  {store.is_default ? <Badge tone="neutral">Principal</Badge> : null}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{selectedStore?.name ?? "Loja"}</h2>
              <p className="mt-1 text-sm text-muted">
                {visibleProducts.length} produto(s) nesta loja. O estoque, o preço e as vendas continuam no mesmo produto após mover.
              </p>
            </div>
            <div className="flex min-w-72 flex-wrap items-center gap-2">
              {visibleProducts.length > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={toggleAllVisibleProducts} disabled={pending}>
                  {visibleProducts.every((product) => selectedProductIds.includes(product.id))
                    ? "Limpar seleção"
                    : "Selecionar todos"}
                </Button>
              ) : null}
              <Select
                value={targetStoreId}
                onChange={(event) => setTargetStoreId(event.target.value)}
                aria-label="Loja de destino"
                disabled={targetStores.length === 0 || pending}
                className="min-w-44 flex-1"
              >
                {targetStores.length === 0 ? <option value="">Crie outra loja no mesmo jogo</option> : null}
                {targetStores.map((store) => <option key={store.id} value={store.id}>Mover para {store.name}</option>)}
              </Select>
              <Button
                type="button"
                onClick={moveProducts}
                disabled={pending || selectedProductIds.length === 0 || !targetStoreId}
              >
                {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRightLeft aria-hidden="true" className="size-4" />}
                {pending ? "Movendo..." : `Mover (${selectedProductIds.length})`}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <ActionFeedback state={state} />
          {visibleProducts.length === 0 ? (
            <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-border bg-surface-muted p-8 text-center">
              <div>
                <PackageOpen aria-hidden="true" className="mx-auto size-7 text-muted" />
                <p className="mt-3 text-sm font-semibold text-foreground">Esta loja ainda está vazia</p>
                <p className="mt-1 text-xs text-muted">Abra outra pasta e mova produtos para cá.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-left">
                <thead className="bg-surface-muted text-xs uppercase tracking-[0.12em] text-muted">
                  <tr>
                    <th className="w-12 px-4 py-3">Selecionar</th>
                    <th className="px-4 py-3">Produto</th>
                    <th className="px-4 py-3">Categoria</th>
                    <th className="px-4 py-3">Disponível</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => (
                    <tr key={product.id} className="border-t border-border/80">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(product.id)}
                          onChange={() => toggleProduct(product.id)}
                          aria-label={`Selecionar ${product.name}`}
                          className="size-4 accent-[#d7ad42]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <MediaThumbnail src={product.image_url} alt="" />
                          <span className="text-sm font-medium text-foreground">{product.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-strong">{product.substores?.name ?? "Categoria"}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-foreground">{product.stock_quantity.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3"><Badge tone={product.status === "active" ? "success" : "neutral"}>{product.status === "active" ? "Ativo" : "Inativo"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
