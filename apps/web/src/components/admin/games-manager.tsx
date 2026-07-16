"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Archive, Gamepad2, LoaderCircle, Pencil } from "lucide-react";

import { saveGameAction } from "@/app/actions/admin";
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
import type { GameRow } from "@/lib/data/admin-repository";

type RelatedCounts = Record<string, { substores: number; products: number }>;

interface GamesManagerProps {
  games: GameRow[];
  relatedCounts: RelatedCounts;
}

function GameForm({ game, onClose }: { game: GameRow | null; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(saveGameAction, initialAdminActionState);
  const formId = useId();

  return (
    <AdminDialog
      open
      onClose={onClose}
      title={game ? "Editar jogo" : "Novo jogo"}
      description="Defina a raiz do catálogo e a imagem usada para identificar o jogo."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {pending ? "Salvando..." : "Salvar jogo"}
          </Button>
        </>
      }
    >
      <form id={formId} action={formAction} className="space-y-5">
        <input type="hidden" name="id" value={game?.id ?? ""} />
        <ActionFeedback state={state} />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nome" htmlFor={`${formId}-name`} error={fieldError(state, "name")}>
            <Input
              id={`${formId}-name`}
              name="name"
              defaultValue={game?.name ?? ""}
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
              defaultValue={game?.slug ?? ""}
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
            defaultValue={game?.description ?? ""}
            maxLength={2_000}
          />
        </Field>

        <MediaUploadField
          name="imageUrl"
          label="Imagem do jogo"
          folder="games"
          initialValue={game?.image_url}
          error={fieldError(state, "imageUrl")}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Estado" htmlFor={`${formId}-status`} error={fieldError(state, "status")}>
            <Select id={`${formId}-status`} name="status" defaultValue={game?.status ?? "active"}>
              {editableCatalogStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Ordem"
            htmlFor={`${formId}-sort-order`}
            hint="menor aparece primeiro"
            error={fieldError(state, "sortOrder")}
          >
            <Input
              id={`${formId}-sort-order`}
              name="sortOrder"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={game?.sort_order ?? 0}
              required
            />
          </Field>
        </div>
      </form>
    </AdminDialog>
  );
}

export function GamesManager({ games, relatedCounts }: GamesManagerProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; game: GameRow } | null>(null);
  const [archiveRecord, setArchiveRecord] = useState<{ id: string; label: string } | null>(null);

  const filteredGames = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return games.filter((game) => {
      const matchesFilter = filter === "all" || game.status === filter;
      const matchesSearch =
        !query ||
        game.name.toLocaleLowerCase("pt-BR").includes(query) ||
        game.slug.toLocaleLowerCase("pt-BR").includes(query) ||
        game.description?.toLocaleLowerCase("pt-BR").includes(query);
      return matchesFilter && Boolean(matchesSearch);
    });
  }, [filter, games, search]);

  const editingGame = editor?.mode === "edit" ? editor.game : null;

  return (
    <>
      <ResourceManagerShell
        eyebrow="Catálogo"
        title="Jogos"
        description="Organize a raiz do catálogo que será compartilhado com as sublojas e o futuro bot."
        actionLabel="Novo jogo"
        onCreate={() => setEditor({ mode: "create" })}
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        filterOptions={catalogStatusOptions}
        columns={["Jogo", "Sublojas", "Produtos", "Ordem", "Status", "Atualizado em", "Ações"]}
        totalCount={games.length}
        visibleCount={filteredGames.length}
        emptyIcon={Gamepad2}
        emptyTitle="Nenhum jogo cadastrado"
        emptyDescription="Crie o primeiro jogo para começar a estruturar o catálogo. Nada será publicado automaticamente."
      >
        {filteredGames.map((game) => {
          const counts = relatedCounts[game.id] ?? { substores: 0, products: 0 };
          return (
            <tr key={game.id} className="border-b border-border/80 last:border-0">
              <td className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <MediaThumbnail src={game.image_url} alt="" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{game.name}</p>
                    <p className="mt-1 max-w-64 truncate text-xs text-muted">/{game.slug}</p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-4 text-sm text-muted-strong">{counts.substores.toLocaleString("pt-BR")}</td>
              <td className="px-5 py-4 text-sm text-muted-strong">{counts.products.toLocaleString("pt-BR")}</td>
              <td className="px-5 py-4 text-sm text-muted-strong">{game.sort_order.toLocaleString("pt-BR")}</td>
              <td className="px-5 py-4"><CatalogStatusBadge status={game.status} /></td>
              <td className="whitespace-nowrap px-5 py-4 text-xs text-muted">
                <time dateTime={game.updated_at}>{formatDateTime(game.updated_at)}</time>
              </td>
              <td className="px-5 py-4">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditor({ mode: "edit", game })}>
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-danger"
                    aria-label={`Arquivar ${game.name}`}
                    title={game.status === "archived" ? "Jogo já arquivado" : "Arquivar jogo"}
                    disabled={game.status === "archived"}
                    onClick={() => setArchiveRecord({ id: game.id, label: game.name })}
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
        <GameForm
          key={editingGame?.id ?? "new-game"}
          game={editingGame}
          onClose={() => setEditor(null)}
        />
      ) : null}
      <ArchiveDialog
        key={archiveRecord?.id ?? "archive-game"}
        target="game"
        record={archiveRecord}
        noun="jogo"
        onClose={() => setArchiveRecord(null)}
      />
    </>
  );
}
