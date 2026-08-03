"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { FolderPlus, Gamepad2, LoaderCircle, Save, Store, Trash2, TriangleAlert } from "lucide-react";

import {
  deleteCatalogStoreAction,
  renameCatalogGameAction,
  saveCatalogStoreAction,
} from "@/app/actions/admin";
import {
  ActionFeedback,
  fieldError,
  initialAdminActionState,
} from "@/components/admin/action-feedback";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-field";

export type CatalogStoreManagerStore = {
  id: string;
  gameId: string;
  gameName: string;
  name: string;
  isDefault: boolean;
  productCount: number;
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
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.3fr_auto] lg:items-end">
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const formId = useId();
  return (
    <div className="rounded-xl border border-border bg-surface-muted p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{store.gameName}</p>
          <p className="mt-1 text-xs text-muted">{store.productCount} produto(s)</p>
        </div>
        {store.isDefault ? <Badge tone="neutral">Principal</Badge> : null}
      </div>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={store.id} />
        {store.isDefault || store.productCount > 0 ? (
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
            hint={store.isDefault ? "Definido pela loja principal" : store.productCount > 0 ? "Esvazie a loja para alterar" : "Pode ser alterado"}
            error={fieldError(state, "gameId")}
          >
            <Select
              id={`${formId}-game`}
              name={store.isDefault || store.productCount > 0 ? undefined : "gameId"}
              defaultValue={store.gameId}
              disabled={store.isDefault || store.productCount > 0}
            >
              {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
            {pending ? "Salvando..." : "Salvar loja"}
          </Button>
          {!store.isDefault ? (
            <Button
              type="button"
              variant="danger"
              aria-label={`Excluir loja ${store.name}`}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Excluir loja
            </Button>
          ) : null}
        </div>
      </form>
      {store.isDefault ? (
        <p className="mt-2 text-xs leading-5 text-muted">
          A loja principal acompanha o jogo e não pode ser excluída ou movida separadamente.
        </p>
      ) : null}
      <DeleteCatalogStoreDialog
        open={deleteOpen}
        store={store}
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

function DeleteCatalogStoreDialog({
  open,
  store,
  onClose,
}: {
  open: boolean;
  store: CatalogStoreManagerStore;
  onClose: () => void;
}) {
  const [state, setState] = useState(initialAdminActionState);
  const [pending, startTransition] = useTransition();
  const hasProducts = store.productCount > 0;

  function close() {
    setState(initialAdminActionState);
    onClose();
  }

  function remove() {
    if (hasProducts) return;
    startTransition(async () => {
      setState(await deleteCatalogStoreAction(store.id));
    });
  }

  return (
    <AdminDialog
      open={open}
      onClose={close}
      title="Excluir loja"
      description="A exclusão preserva o histórico e não apaga o canal do Discord."
      footer={
        state.ok ? (
          <Button onClick={close}>Concluir</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={remove} disabled={pending || hasProducts}>
              {pending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" className="size-4" />
              )}
              {pending ? "Excluindo..." : "Confirmar exclusão"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted-strong">
          Você está prestes a excluir <strong className="font-semibold text-foreground">{store.name}</strong>.
          A mensagem da vitrine será removida, mas o canal permanecerá no servidor.
        </p>
        {hasProducts ? (
          <div className="flex gap-3 rounded-xl border border-warning/25 bg-warning/[0.06] p-3 text-warning">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm leading-5">
              Mova os {store.productCount} produto(s) para outra loja pela aba Estoque antes de excluir.
            </p>
          </div>
        ) : null}
        <ActionFeedback state={state} />
      </div>
    </AdminDialog>
  );
}
