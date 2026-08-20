"use client";

import { useActionState, useId, useMemo, useState } from "react";
import {
  CheckCircle2,
  Gem,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Store,
} from "lucide-react";

import { publishDiscordStorefrontAction } from "@/app/actions/admin";
import {
  ActionFeedback,
  fieldError,
  initialAdminActionState,
} from "@/components/admin/action-feedback";
import {
  formatCentsForInput,
  formatCommissionForInput,
  formatDateTime,
} from "@/components/admin/admin-format";
import { Notice } from "@/components/admin/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-field";
import type { BoosterDiscountConfiguration } from "@/lib/bot/booster-discount";
import type {
  DiscordStorefrontChannel,
  DiscordStorefrontConfiguration,
} from "@/lib/bot/discord-storefront";
import type { DiscordRobuxStorefrontConfiguration } from "@/lib/bot/discord-robux-storefront";

export type DiscordStorefrontGameOption = {
  id: string;
  name: string;
  gameId?: string;
  gameName?: string;
  categoryCount: number;
  productCount: number;
};

export type DiscordStorefrontGuildOption = {
  id: string;
  discordGuildId: string;
  name: string;
  channels: DiscordStorefrontChannel[];
  current: DiscordStorefrontConfiguration[];
  robux?: DiscordRobuxStorefrontConfiguration | null;
  boosterDiscount: BoosterDiscountConfiguration;
  channelLoadError: string | null;
};

export function DiscordStorefrontForm({
  guilds,
  games,
}: {
  guilds: DiscordStorefrontGuildOption[];
  games: DiscordStorefrontGameOption[];
}) {
  const initialGuild = guilds.find((guild) => guild.current.length > 0) ?? guilds[0] ?? null;
  const initialGameId = preferredGameId(initialGuild, games);
  const [selectedGuildId, setSelectedGuildId] = useState(initialGuild?.id ?? "");
  const [selectedGameId, setSelectedGameId] = useState(initialGameId);
  const [selectedChannelId, setSelectedChannelId] = useState(
    preferredChannelId(initialGuild, initialGameId),
  );
  const initialDiscount = discountFormValues(initialGuild);
  const [boosterDiscountEnabled, setBoosterDiscountEnabled] = useState(initialDiscount.enabled);
  const [boosterDiscountPercent, setBoosterDiscountPercent] = useState(initialDiscount.percent);
  const [boosterMinimumSubtotal, setBoosterMinimumSubtotal] = useState(initialDiscount.minimum);
  const [state, formAction, pending] = useActionState(
    publishDiscordStorefrontAction,
    initialAdminActionState,
  );
  const formId = useId();
  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) ?? null,
    [guilds, selectedGuildId],
  );
  const selectedGame = games.find((game) => game.id === selectedGameId) ?? null;
  const selectedStorefront =
    selectedGuild?.current.find(
      (storefront) => storefront.catalog_store_id === selectedGameId,
    ) ?? null;
  const legacyStorefront =
    selectedGuild?.current.length === 1 && selectedGuild.current[0]?.game_id === null
      ? selectedGuild.current[0]
      : null;
  const selectedChannel = selectedGuild?.channels.find(
    (channel) => channel.id === selectedChannelId,
  ) ?? null;

  function changeGuild(guildId: string) {
    const guild = guilds.find((item) => item.id === guildId) ?? null;
    const gameId = preferredGameId(guild, games);
    setSelectedGuildId(guildId);
    setSelectedGameId(gameId);
    setSelectedChannelId(preferredChannelId(guild, gameId));
    const discount = discountFormValues(guild);
    setBoosterDiscountEnabled(discount.enabled);
    setBoosterDiscountPercent(discount.percent);
    setBoosterMinimumSubtotal(discount.minimum);
  }

  function changeGame(gameId: string) {
    setSelectedGameId(gameId);
    setSelectedChannelId(preferredChannelId(selectedGuild, gameId));
  }

  function editStorefront(storefront: DiscordStorefrontConfiguration) {
    const gameId = storefront.catalog_store_id ?? games.find(
      (store) => store.gameId === storefront.game_id,
    )?.id ?? games[0]?.id ?? "";
    setSelectedGameId(gameId);
    setSelectedChannelId(storefront.channel_id);
  }

  const canPublish = Boolean(
    selectedGuild &&
      selectedGame &&
      selectedChannelId &&
      !selectedGuild.channelLoadError,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">Vitrines do Discord</h2>
              <Badge tone="gold">Por loja</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Crie uma vitrine para cada loja ou mundo. Cada uma fica no seu próprio canal e
              mostra somente o estoque separado daquela loja.
            </p>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.06] text-gold">
            <MessageSquareText aria-hidden="true" className="size-[18px]" />
          </span>
        </div>
      </CardHeader>

      {guilds.length === 0 ? (
        <CardContent>
          <Notice>
            Nenhum servidor ativo foi encontrado. Use <strong>/loja</strong> no Discord
            autorizado e volte a esta tela.
          </Notice>
        </CardContent>
      ) : games.length === 0 ? (
        <CardContent>
          <Notice>
            Cadastre um jogo e crie uma loja antes de publicar a primeira vitrine.
          </Notice>
        </CardContent>
      ) : (
        <form action={formAction}>
          <CardContent className="space-y-6 pt-5">
            <ActionFeedback state={state} />
            <input type="hidden" name="guildId" value={selectedGuildId} />
            <input type="hidden" name="storeId" value={selectedGameId} />

            <div className="rounded-xl border border-success/20 bg-success/[0.045] p-4">
              <p className="text-sm font-semibold text-foreground">Como funciona</p>
              <ol className="mt-3 grid gap-3 text-sm text-muted-strong md:grid-cols-3">
                <Step number="1" text="Escolha a loja/mundo." />
                <Step number="2" text="Cole o UID do canal dessa loja." />
                <Step number="3" text="Publique o estoque independente." />
              </ol>
            </div>

            {selectedGuild?.current.length ? (
              <section aria-labelledby={`${formId}-published-title`} className="space-y-3">
                <div>
                  <h3 id={`${formId}-published-title`} className="text-sm font-semibold text-foreground">
                    Vitrines já publicadas
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Para mover ou atualizar uma delas, clique em Configurar.
                  </p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {selectedGuild.current.map((storefront) => (
                    <div
                      key={storefront.catalog_store_id ?? storefront.game_id ?? "legacy"}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted p-4"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-success/20 bg-success/[0.07] text-success">
                          <CheckCircle2 aria-hidden="true" className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {storefront.catalog_store_id
                              ? storefront.catalog_store_name
                              : storefront.game_id
                                ? `${storefront.game_name} · Loja principal`
                                : "Vitrine antiga"}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted">
                            #{storefront.channel_name} · atualizada em{" "}
                            {formatDateTime(storefront.published_at)}
                          </p>
                          <p className="mt-1 truncate font-mono text-[11px] text-muted">
                            Canal ID: {storefront.channel_id}
                          </p>
                          {!storefront.game_id ? (
                            <p className="mt-1 text-xs font-medium text-warning">
                              Escolha um jogo para separar os produtos desta vitrine.
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editStorefront(storefront)}
                      >
                        Configurar
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section aria-labelledby={`${formId}-setup-title`} className="space-y-4">
              <div>
                <h3 id={`${formId}-setup-title`} className="text-sm font-semibold text-foreground">
                  {selectedStorefront || legacyStorefront
                    ? "Atualizar uma vitrine"
                    : "Adicionar nova vitrine"}
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Cada loja usa um canal e estoque próprios. Publicar novamente atualiza a mesma
                  mensagem, sem criar cópias.
                </p>
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                <Field
                  label="Servidor"
                  htmlFor={`${formId}-guild`}
                  error={fieldError(state, "guildId")}
                >
                  <Select
                    id={`${formId}-guild`}
                    value={selectedGuildId}
                    onChange={(event) => changeGuild(event.target.value)}
                  >
                    {guilds.map((guild) => (
                      <option key={guild.id} value={guild.id}>
                        {guild.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="1. Loja/mundo desta vitrine"
                  htmlFor={`${formId}-game`}
                  error={fieldError(state, "storeId")}
                >
                  <Select
                    id={`${formId}-game`}
                    value={selectedGameId}
                    onChange={(event) => changeGame(event.target.value)}
                  >
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.name}{game.gameName ? ` · ${game.gameName}` : ""} · {game.productCount} produto
                        {game.productCount === 1 ? "" : "s"}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="2. UID do canal no Discord"
                  htmlFor={`${formId}-channel`}
                  hint="Cole o ID ou escolha uma sugestão"
                  error={fieldError(state, "channelId")}
                >
                  <Input
                    id={`${formId}-channel`}
                    name="channelId"
                    list={`${formId}-channel-options`}
                    value={selectedChannelId}
                    onChange={(event) => setSelectedChannelId(event.target.value)}
                    placeholder="123456789012345678"
                    inputMode="numeric"
                    pattern="[0-9]{15,22}"
                    maxLength={22}
                    disabled={!selectedGuild}
                    required
                  />
                  <datalist id={`${formId}-channel-options`}>
                    {selectedGuild?.channels.map((channel) => {
                      const usedBy = selectedGuild.current.find(
                        (storefront) =>
                          Boolean(storefront.catalog_store_id) &&
                          storefront.catalog_store_id !== selectedGameId &&
                          storefront.channel_id === channel.id,
                      );
                      return (
                        <option key={channel.id} value={channel.id}>
                          {channel.categoryName ? `${channel.categoryName} / ` : ""}#{channel.name}{usedBy ? ` · usado por ${usedBy.catalog_store_name}` : ""}
                        </option>
                      );
                    })}
                  </datalist>
                  {selectedChannel ? (
                    <p className="mt-2 text-xs text-muted">
                      Canal reconhecido: <strong className="text-muted-strong">#{selectedChannel.name}</strong>
                    </p>
                  ) : selectedChannelId ? (
                    <p className="mt-2 text-xs text-warning">
                      O bot validará se esse ID pertence ao servidor antes de publicar.
                    </p>
                  ) : null}
                </Field>
              </div>

              {selectedGame ? (
                <div className="flex items-start gap-3 rounded-xl border border-gold/20 bg-gold/[0.035] p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-gold/20 bg-gold/[0.08] text-gold">
                    <Store aria-hidden="true" className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      O que aparecerá em {selectedGame.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {selectedGame.productCount} produto
                      {selectedGame.productCount === 1 ? "" : "s"} de{" "}
                      {selectedGame.categoryCount} categoria
                      {selectedGame.categoryCount === 1 ? "" : "s"}. Produtos de outras lojas
                      não aparecerão neste canal.
                    </p>
                  </div>
                </div>
              ) : null}
            </section>

            {selectedGuild?.channelLoadError ? (
              <Notice>{selectedGuild.channelLoadError}</Notice>
            ) : null}

            <details className="rounded-xl border border-border bg-surface-muted">
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 text-sm font-semibold text-foreground">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-gold/20 bg-gold/[0.08] text-gold">
                  <Gem aria-hidden="true" className="size-4" />
                </span>
                Desconto para Nitro Boosters
                <span className="ml-auto text-xs font-normal text-muted">
                  Opcional · vale em todas as vitrines
                </span>
              </summary>
              <div className="space-y-4 border-t border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="max-w-2xl text-xs leading-5 text-muted">
                    O bot confirma o boost no servidor antes de calcular o Pix. Esta regra é única
                    para todas as lojas.
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-strong">
                    <input
                      type="checkbox"
                      name="boosterDiscountEnabled"
                      checked={boosterDiscountEnabled}
                      onChange={(event) => setBoosterDiscountEnabled(event.target.checked)}
                      className="size-4 accent-[#d7ad42]"
                    />
                    Ativo
                  </label>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field
                    label="Percentual de desconto"
                    htmlFor={`${formId}-booster-percent`}
                    hint="Até 90%"
                    error={
                      fieldError(state, "boosterDiscountPercent") ??
                      fieldError(state, "boosterDiscountBps")
                    }
                  >
                    <div className="relative">
                      <Input
                        id={`${formId}-booster-percent`}
                        name="boosterDiscountPercent"
                        inputMode="decimal"
                        value={boosterDiscountPercent}
                        onChange={(event) => setBoosterDiscountPercent(event.target.value)}
                        className="pr-10"
                        required
                      />
                      <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
                    </div>
                  </Field>
                  <Field
                    label="Compra mínima"
                    htmlFor={`${formId}-booster-minimum`}
                    hint="Antes do desconto"
                    error={
                      fieldError(state, "boosterMinimumSubtotal") ??
                      fieldError(state, "boosterMinimumSubtotalCents")
                    }
                  >
                    <div className="relative">
                      <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
                      <Input
                        id={`${formId}-booster-minimum`}
                        name="boosterMinimumSubtotal"
                        inputMode="decimal"
                        value={boosterMinimumSubtotal}
                        onChange={(event) => setBoosterMinimumSubtotal(event.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </Field>
                </div>
              </div>
            </details>
          </CardContent>

          <CardFooter className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-5 text-muted">
              O comando <strong>/loja</strong> continua disponível como alternativa.
            </p>
            <Button type="submit" disabled={pending || !canPublish}>
              {pending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="size-4" />
              )}
              {pending
                ? "Publicando..."
                : selectedStorefront || legacyStorefront
                  ? "Atualizar vitrine"
                  : "Publicar nova vitrine"}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success/15 text-xs font-bold text-success">
        {number}
      </span>
      {text}
    </li>
  );
}

function discountFormValues(guild: DiscordStorefrontGuildOption | null) {
  const discount = guild?.boosterDiscount;
  return {
    enabled: discount?.enabled ?? true,
    percent: formatCommissionForInput(discount?.discount_bps ?? 500),
    minimum: formatCentsForInput(discount?.minimum_subtotal_cents ?? 5_000),
  };
}

function preferredGameId(
  guild: DiscordStorefrontGuildOption | null,
  games: DiscordStorefrontGameOption[],
) {
  if (!games.length) return "";
  const configuredGameIds = new Set(
    guild?.current
      .map((storefront) => storefront.catalog_store_id)
      .filter((gameId): gameId is string => Boolean(gameId)) ?? [],
  );
  return (
    games.find((game) => !configuredGameIds.has(game.id))?.id ??
    guild?.current.find((storefront) => storefront.catalog_store_id)?.catalog_store_id ??
    games[0]?.id ??
    ""
  );
}

function preferredChannelId(
  guild: DiscordStorefrontGuildOption | null,
  gameId: string,
) {
  if (!guild) return "";
  const current =
    guild.current.find((storefront) => storefront.catalog_store_id === gameId) ??
    (guild.current.length === 1 && guild.current[0]?.game_id === null
      ? guild.current[0]
      : null);
  return guild.channels.some((channel) => channel.id === current?.channel_id)
    ? current?.channel_id ?? ""
    : guild.channels.find(
        (channel) =>
          !guild.current.some(
            (storefront) =>
              Boolean(storefront.catalog_store_id) &&
              storefront.catalog_store_id !== gameId &&
              storefront.channel_id === channel.id,
          ),
      )?.id ?? "";
}
