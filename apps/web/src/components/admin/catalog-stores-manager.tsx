"use client";

import { useActionState, useId } from "react";
import { FolderPlus, LoaderCircle, Save, Store } from "lucide-react";

import { saveCatalogStoreAction } from "@/app/actions/admin";
import {
  ActionFeedback,
  fieldError,
  initialAdminActionState,
} from "@/components/admin/action-feedback";
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

export function CatalogStoresManager({
  stores,
  games,
  guilds,
}: {
  stores: CatalogStoreManagerStore[];
  games: Array<{ id: string; name: string }>;
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
            <CatalogStoreNameForm key={store.id} store={store} />
          ))}
        </div>

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

function CatalogStoreNameForm({ store }: { store: CatalogStoreManagerStore }) {
  const [state, formAction, pending] = useActionState(
    saveCatalogStoreAction,
    initialAdminActionState,
  );
  const formId = useId();
  return (
    <form action={formAction} className="rounded-xl border border-border bg-surface-muted p-4">
      <input type="hidden" name="id" value={store.id} />
      <input type="hidden" name="gameId" value={store.gameId} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{store.gameName}</p>
          <p className="mt-1 text-xs text-muted">{store.productCount} produto(s)</p>
        </div>
        {store.isDefault ? <Badge tone="neutral">Principal</Badge> : null}
      </div>
      <ActionFeedback state={state} />
      <div className="mt-3 flex gap-2">
        <Input
          id={`${formId}-name`}
          name="name"
          defaultValue={store.name}
          maxLength={120}
          aria-label={`Nome da loja ${store.name}`}
          required
        />
        <Button type="submit" size="icon" variant="secondary" disabled={pending} aria-label="Salvar nome da loja">
          {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
        </Button>
      </div>
    </form>
  );
}
