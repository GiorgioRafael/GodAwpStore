"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Archive, LoaderCircle, Pencil, Store } from "lucide-react";

import { saveSubstoreAction } from "@/app/actions/admin";
import { ActionFeedback, fieldError, initialAdminActionState } from "@/components/admin/action-feedback";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { formatDateTime } from "@/components/admin/admin-format";
import { ArchiveDialog } from "@/components/admin/archive-dialog";
import { CatalogStatusBadge, editableCatalogStatuses } from "@/components/admin/catalog-status";
import { MediaThumbnail } from "@/components/admin/media-thumbnail";
import { MediaUploadField } from "@/components/admin/media-upload-field";
import {
  catalogStatusOptions,
  ResourceManagerShell,
} from "@/components/admin/resource-manager-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-field";
import type { GameRow, SubstoreRow } from "@/lib/data/admin-repository";

interface SubstoresManagerProps {
  games: GameRow[];
  substores: SubstoreRow[];
  productCounts: Record<string, number>;
}

function SubstoreForm({
  substore,
  games,
  onClose,
}: {
  substore: SubstoreRow | null;
  games: GameRow[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveSubstoreAction, initialAdminActionState);
  const formId = useId();
  const selectableGames = games.filter(
    (game) => game.status !== "archived" || game.id === substore?.game_id,
  );

  return (
    <AdminDialog
      open
      onClose={onClose}
      size="lg"
      title={substore ? "Editar subloja" : "Nova subloja"}
      description="Configure a vitrine-base que o futuro bot usará no Discord."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {pending ? "Salvando..." : "Salvar subloja"}
          </Button>
        </>
      }
    >
      <form id={formId} action={formAction} className="space-y-5">
        <input type="hidden" name="id" value={substore?.id ?? ""} />
        <ActionFeedback state={state} />

        <Field label="Jogo" htmlFor={`${formId}-game`} error={fieldError(state, "gameId")}>
          <Select
            id={`${formId}-game`}
            name="gameId"
            defaultValue={substore?.game_id ?? selectableGames[0]?.id ?? ""}
            required
          >
            <option value="" disabled>Selecione um jogo</option>
            {selectableGames.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}{game.status === "archived" ? " (arquivado)" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nome interno" htmlFor={`${formId}-name`} error={fieldError(state, "name")}>
            <Input
              id={`${formId}-name`}
              name="name"
              defaultValue={substore?.name ?? ""}
              maxLength={120}
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
              defaultValue={substore?.slug ?? ""}
              maxLength={80}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="Título da vitrine" htmlFor={`${formId}-title`} error={fieldError(state, "title")}>
          <Input
            id={`${formId}-title`}
            name="title"
            defaultValue={substore?.title ?? ""}
            maxLength={256}
            required
          />
        </Field>

        <Field label="Descrição da vitrine" htmlFor={`${formId}-description`} error={fieldError(state, "description")}>
          <Textarea
            id={`${formId}-description`}
            name="description"
            defaultValue={substore?.description ?? ""}
            maxLength={4_096}
            required
            className="min-h-36"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Cor" htmlFor={`${formId}-color`} hint="#RRGGBB" error={fieldError(state, "color")}>
            <Input
              id={`${formId}-color`}
              name="color"
              defaultValue={substore?.color_hex ?? "#D4AF37"}
              maxLength={7}
              pattern="#[0-9a-fA-F]{6}"
              required
            />
          </Field>
          <Field label="Estado" htmlFor={`${formId}-status`} error={fieldError(state, "status")}>
            <Select id={`${formId}-status`} name="status" defaultValue={substore?.status ?? "active"}>
              {editableCatalogStatuses.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ordem" htmlFor={`${formId}-sort-order`} error={fieldError(state, "sortOrder")}>
            <Input
              id={`${formId}-sort-order`}
              name="sortOrder"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={substore?.sort_order ?? 0}
              required
            />
          </Field>
        </div>

        <MediaUploadField
          name="imageUrl"
          label="Imagem principal"
          folder="substores"
          initialValue={substore?.image_url}
          error={fieldError(state, "imageUrl")}
        />
        <MediaUploadField
          name="thumbnailUrl"
          label="Miniatura"
          folder="substores"
          initialValue={substore?.thumbnail_url}
          error={fieldError(state, "thumbnailUrl")}
        />

        <div className="rounded-xl border border-border bg-white/[0.018] p-4">
          <h3 className="text-sm font-semibold text-foreground">Identidade do embed</h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            Os ícones podem usar uma URL pública. Author e footer são opcionais.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="Author" htmlFor={`${formId}-author`} hint="Opcional" error={fieldError(state, "authorName")}>
              <Input id={`${formId}-author`} name="authorName" defaultValue={substore?.author_name ?? ""} maxLength={256} />
            </Field>
            <Field label="URL do ícone do author" htmlFor={`${formId}-author-icon`} hint="Opcional" error={fieldError(state, "authorIconUrl")}>
              <Input id={`${formId}-author-icon`} name="authorIconUrl" type="url" defaultValue={substore?.author_icon_url ?? ""} maxLength={2_048} />
            </Field>
            <Field label="Footer" htmlFor={`${formId}-footer`} hint="Opcional" error={fieldError(state, "footerText")}>
              <Input id={`${formId}-footer`} name="footerText" defaultValue={substore?.footer_text ?? ""} maxLength={2_048} />
            </Field>
            <Field label="URL do ícone do footer" htmlFor={`${formId}-footer-icon`} hint="Opcional" error={fieldError(state, "footerIconUrl")}>
              <Input id={`${formId}-footer-icon`} name="footerIconUrl" type="url" defaultValue={substore?.footer_icon_url ?? ""} maxLength={2_048} />
            </Field>
          </div>
        </div>
      </form>
    </AdminDialog>
  );
}

export function SubstoresManager({ games, substores, productCounts }: SubstoresManagerProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "edit"; substore: SubstoreRow } | null
  >(null);
  const [archiveRecord, setArchiveRecord] = useState<{ id: string; label: string } | null>(null);

  const filteredSubstores = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return substores.filter((substore) => {
      const matchesFilter = filter === "all" || substore.status === filter;
      const matchesSearch =
        !query ||
        substore.name.toLocaleLowerCase("pt-BR").includes(query) ||
        substore.slug.toLocaleLowerCase("pt-BR").includes(query) ||
        substore.title.toLocaleLowerCase("pt-BR").includes(query) ||
        substore.games?.name.toLocaleLowerCase("pt-BR").includes(query);
      return matchesFilter && Boolean(matchesSearch);
    });
  }, [filter, search, substores]);

  const editingSubstore = editor?.mode === "edit" ? editor.substore : null;
  const hasAvailableGame = games.some((game) => game.status !== "archived");

  return (
    <>
      <ResourceManagerShell
        eyebrow="Catálogo"
        title="Sublojas"
        description="Defina as vitrines por jogo, incluindo conteúdo-base e identidade visual usada no Discord."
        actionLabel="Nova subloja"
        onCreate={() => setEditor({ mode: "create" })}
        createDisabled={!hasAvailableGame}
        createDisabledReason="Crie ou reative um jogo antes de cadastrar uma subloja."
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        filterOptions={catalogStatusOptions}
        columns={["Subloja", "Jogo", "Produtos", "Cor", "Status", "Atualizado em", "Ações"]}
        totalCount={substores.length}
        visibleCount={filteredSubstores.length}
        emptyIcon={Store}
        emptyTitle="Nenhuma subloja cadastrada"
        emptyDescription="As sublojas aparecerão aqui depois que um jogo for criado e a primeira vitrine for configurada."
      >
        {filteredSubstores.map((substore) => (
          <tr key={substore.id} className="border-b border-border/80 last:border-0">
            <td className="px-5 py-4">
              <div className="flex items-center gap-3">
                <MediaThumbnail src={substore.thumbnail_url ?? substore.image_url} alt="" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{substore.name}</p>
                  <p className="mt-1 max-w-64 truncate text-xs text-muted">{substore.title}</p>
                </div>
              </div>
            </td>
            <td className="px-5 py-4 text-sm text-muted-strong">{substore.games?.name ?? "Jogo removido"}</td>
            <td className="px-5 py-4 text-sm text-muted-strong">{(productCounts[substore.id] ?? 0).toLocaleString("pt-BR")}</td>
            <td className="px-5 py-4">
              <span className="inline-flex items-center gap-2 text-xs text-muted-strong">
                <span className="size-4 rounded-full border border-white/20" style={{ backgroundColor: substore.color_hex }} aria-hidden="true" />
                {substore.color_hex}
              </span>
            </td>
            <td className="px-5 py-4"><CatalogStatusBadge status={substore.status} /></td>
            <td className="whitespace-nowrap px-5 py-4 text-xs text-muted">
              <time dateTime={substore.updated_at}>{formatDateTime(substore.updated_at)}</time>
            </td>
            <td className="px-5 py-4">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditor({ mode: "edit", substore })}>
                  <Pencil aria-hidden="true" className="size-3.5" />
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-danger"
                  aria-label={`Arquivar ${substore.name}`}
                  title={substore.status === "archived" ? "Subloja já arquivada" : "Arquivar subloja"}
                  disabled={substore.status === "archived"}
                  onClick={() => setArchiveRecord({ id: substore.id, label: substore.name })}
                >
                  <Archive aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </ResourceManagerShell>

      {editor ? (
        <SubstoreForm
          key={editingSubstore?.id ?? "new-substore"}
          substore={editingSubstore}
          games={games}
          onClose={() => setEditor(null)}
        />
      ) : null}
      <ArchiveDialog
        key={archiveRecord?.id ?? "archive-substore"}
        target="substore"
        record={archiveRecord}
        noun="subloja"
        onClose={() => setArchiveRecord(null)}
      />
    </>
  );
}
