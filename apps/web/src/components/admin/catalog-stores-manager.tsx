"use client";

import { useActionState, useId, useState } from "react";
import { Archive, FolderPlus, Gamepad2, LoaderCircle, Save, Store, Trash2 } from "lucide-react";

import {
  renameCatalogGameAction,
  saveCatalogStoreAction,
} from "@/app/actions/admin";
import {
  ActionFeedback,
  fieldError,
  initialAdminActionState,
} from "@/components/admin/action-feedback";
import { ArchiveDialog } from "@/components/admin/archive-dialog";
import { DeleteRecordDialog } from "@/components/admin/delete-record-dialog";
import { MediaUploadField } from "@/components/admin/media-upload-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-field";

export type CatalogStoreManagerStore = {
  id: string;
  gameId: string;
  gameName: string;
  name: string;
  bannerUrl: string | null;
  isDefault: boolean;
  liveProductCount: number;
  totalProductCount: number;
};

export type CatalogStoreManagerGame = {
  id: string;
  name: string;
};

export function CatalogStoresManager({
  stores,
  games,
  guilds,
}: {
  stores: CatalogStoreManagerStore[];
  games: CatalogStoreManagerGame[];
  guilds: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(
    saveCatalogStoreAction,
    initialAdminActionState,
  );
  const formId = useId();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">Lojas e mundos</h2>
              <Badge tone="gold">Estoque independente</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Cada loja possui seu próprio canal no Discord e somente os produtos movidos para
              ela. Pedidos antigos continuam vinculados ao produto original.
            </p>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.06] text-gold">
            <Store aria-hidden="true" className="size-[18px]" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-3 lg:grid-cols-2">
          {stores.map((store) => (
            <CatalogStoreCard key={store.id} store={store} games={games} />
          ))}
        </div>

        <details className="rounded-xl border border-border bg-surface-muted">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 text-sm font-semibold text-foreground">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-gold/20 bg-gold/[0.07] text-gold">
              <Gamepad2 aria-hidden="true" className="size-4" />
            </span>
            Renomear jogos
            <span className="ml-auto text-xs font-normal text-muted">
              Atualiza todas as lojas vinculadas
            </span>
          </summary>
          <div className="grid gap-3 border-t border-border p-4 lg:grid-cols-2">
            {games.map((game) => <CatalogGameNameForm key={game.id} game={game} />)}
          </div>
        </details>

        <form action={formAction} className="space-y-4 rounded-xl border border-border bg-surface-muted p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg border border-gold/20 bg-gold/[0.07] text-gold">
              <FolderPlus aria-hidden="true" className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Criar nova loja</h3>
              <p className="mt-0.5 text-xs text-muted">
                O bot tentará criar e publicar automaticamente um novo canal de texto.
              </p>
            </div>
          </div>
          <ActionFeedback state={state} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Field label="Jogo" htmlFor={`${formId}-game`} error={fieldError(state, "gameId")}>
              <Select id={`${formId}-game`} name="gameId" required>
                {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
              </Select>
            </Field>
            <Field label="Servidor" htmlFor={`${formId}-guild`} error={fieldError(state, "guildId")}>
              <Select id={`${formId}-guild`} name="guildId" required>
                {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
              </Select>
            </Field>
            <Field label="Nome da loja/mundo" htmlFor={`${formId}-name`} error={fieldError(state, "name")}>
              <Input
                id={`${formId}-name`}
                name="name"
                placeholder="Ex.: Mundo 2"
                maxLength={120}
                autoComplete="off"
                required
              />
            </Field>
          </div>
          <MediaUploadField
            name="bannerUrl"
            label="Banner da vitrine desta loja"
            folder="storefronts"
            error={fieldError(state, "bannerUrl")}
            clearLabel="Usar banner global"
            clearMessage="O banner global será usado quando a loja for salva."
            hint="Opcional. JPG, PNG ou WebP de até 5 MB."
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || games.length === 0 || guilds.length === 0}>
              {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <FolderPlus aria-hidden="true" className="size-4" />}
              {pending ? "Criando..." : "Criar loja"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CatalogStoreCard({
  store,
  games,
}: {
  store: CatalogStoreManagerStore;
  games: CatalogStoreManagerGame[];
}) {
  const [state, formAction, pending] = useActionState(
    saveCatalogStoreAction,
    initialAdminActionState,
  );
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const formId = useId();
  const archiveBlockedReason = store.isDefault
    ? "A loja principal acompanha o jogo. Arquive o jogo para removê-la da vitrine."
    : store.liveProductCount > 0
      ? `Mova os ${store.liveProductCount} produto(s) não arquivado(s) para outra loja antes de arquivar.`
      : null;
  const deleteBlockedReason = store.isDefault
    ? "A loja principal é protegida. Exclua definitivamente o jogo quando todas as categorias e produtos tiverem sido removidos."
    : store.totalProductCount > 0
      ? `Esta loja ainda possui ${store.totalProductCount} produto(s), incluindo arquivados. Remova-os definitivamente antes de excluir a loja.`
      : null;
  return (
    <div className="rounded-xl border border-border bg-surface-muted p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{store.gameName}</p>
          <p className="mt-1 text-xs text-muted">
            {store.liveProductCount} não arquivado(s) · {store.totalProductCount} no total
          </p>
        </div>
        {store.isDefault ? <Badge tone="neutral">Principal</Badge> : null}
      </div>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={store.id} />
        {store.isDefault || store.totalProductCount > 0 ? (
          <input type="hidden" name="gameId" value={store.gameId} />
        ) : null}
        <ActionFeedback state={state} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome da loja" htmlFor={`${formId}-name`} error={fieldError(state, "name")}>
            <Input
              id={`${formId}-name`}
              name="name"
              defaultValue={store.name}
              maxLength={120}
              required
            />
          </Field>
          <Field
            label="Jogo da loja"
            htmlFor={`${formId}-game`}
            hint={store.isDefault ? "Definido pela loja principal" : store.totalProductCount > 0 ? "Esvazie a loja para alterar" : "Pode ser alterado"}
            error={fieldError(state, "gameId")}
          >
            <Select
              id={`${formId}-game`}
              name={store.isDefault || store.totalProductCount > 0 ? undefined : "gameId"}
              defaultValue={store.gameId}
              disabled={store.isDefault || store.totalProductCount > 0}
            >
              {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
            </Select>
          </Field>
        </div>
        <MediaUploadField
          name="bannerUrl"
          label="Banner da vitrine desta loja"
          folder="storefronts"
          initialValue={store.bannerUrl}
          error={fieldError(state, "bannerUrl")}
          clearLabel="Usar banner global"
          clearMessage="O banner global será usado quando a loja for salva."
          hint="Opcional. JPG, PNG ou WebP de até 5 MB."
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
            {pending ? "Salvando..." : "Salvar loja"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            aria-label={`Arquivar loja ${store.name}`}
            onClick={() => setArchiveOpen(true)}
          >
            <Archive aria-hidden="true" className="size-4" />
            Arquivar
          </Button>
          <Button
            type="button"
            variant="danger"
            aria-label={`Excluir definitivamente loja ${store.name}`}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 aria-hidden="true" className="size-4" />
            Excluir definitivamente
          </Button>
        </div>
      </form>
      {store.isDefault ? (
        <p className="mt-2 text-xs leading-5 text-muted">
          A loja principal acompanha o jogo e não pode ser excluída ou movida separadamente.
        </p>
      ) : null}
      <ArchiveDialog
        target="catalogStore"
        noun="loja"
        record={archiveOpen ? {
          id: store.id,
          label: store.name,
          blockedReason: archiveBlockedReason,
        } : null}
        onClose={() => setArchiveOpen(false)}
      />
      <DeleteRecordDialog
        target="catalogStore"
        noun="loja"
        description="A mensagem e a configuração da vitrine serão removidas, mas o canal do Discord será preservado."
        record={deleteOpen ? {
          id: store.id,
          label: store.name,
          blockedReason: deleteBlockedReason,
        } : null}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

function CatalogGameNameForm({ game }: { game: CatalogStoreManagerGame }) {
  const [state, formAction, pending] = useActionState(
    renameCatalogGameAction,
    initialAdminActionState,
  );
  const formId = useId();

  return (
    <form action={formAction} className="rounded-xl border border-border bg-surface p-3">
      <input type="hidden" name="id" value={game.id} />
      <ActionFeedback state={state} />
      <div className="mt-2 flex gap-2">
        <Input
          id={`${formId}-name`}
          name="name"
          defaultValue={game.name}
          maxLength={120}
          aria-label={`Nome do jogo ${game.name}`}
          required
        />
        <Button
          type="submit"
          size="icon"
          variant="secondary"
          disabled={pending}
          aria-label={`Salvar nome do jogo ${game.name}`}
        >
          {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
        </Button>
      </div>
    </form>
  );
}
