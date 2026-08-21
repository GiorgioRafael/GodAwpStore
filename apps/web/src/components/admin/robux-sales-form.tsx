"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Coins, LoaderCircle, RefreshCw } from "lucide-react";

import { publishDiscordRobuxStorefrontAction } from "@/app/actions/admin";
import {
  ActionFeedback,
  fieldError,
  initialAdminActionState,
} from "@/components/admin/action-feedback";
import { formatDateTime } from "@/components/admin/admin-format";
import { Notice } from "@/components/admin/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form-field";
import type { DiscordStorefrontGuildOption } from "./discord-storefront-form";

export function RobuxSalesForm({ guilds }: { guilds: DiscordStorefrontGuildOption[] }) {
  const initialGuild = guilds.find((guild) => guild.robux || findCatalogRobuxStorefront(guild)) ?? guilds[0] ?? null;
  const [guildId, setGuildId] = useState(initialGuild?.id ?? "");
  const [channelId, setChannelId] = useState(
    initialGuild?.robux?.channel_id ?? findCatalogRobuxStorefront(initialGuild)?.channel_id ?? "",
  );
  const [state, formAction, pending] = useActionState(
    publishDiscordRobuxStorefrontAction,
    initialAdminActionState,
  );
  const formId = useId();
  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === guildId) ?? null,
    [guildId, guilds],
  );
  const selectedChannel = selectedGuild?.channels.find((channel) => channel.id === channelId);
  const catalogRobuxStorefront = findCatalogRobuxStorefront(selectedGuild);
  const replacesCatalogRobuxStorefront =
    catalogRobuxStorefront?.channel_id === channelId ? catalogRobuxStorefront : null;

  function changeGuild(nextGuildId: string) {
    const guild = guilds.find((item) => item.id === nextGuildId) ?? null;
    setGuildId(nextGuildId);
    setChannelId(guild?.robux?.channel_id ?? findCatalogRobuxStorefront(guild)?.channel_id ?? "");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">Venda de Robux</h2>
              <Badge tone="gold">Somente GWStore</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Publique uma mensagem própria em outro canal. O comprador informa a quantidade,
              confere o valor e só então gera o Pix. Um ticket privado abre após o pagamento.
            </p>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.06] text-gold">
            <Coins aria-hidden="true" className="size-[18px]" />
          </span>
        </div>
      </CardHeader>

      {guilds.length === 0 ? (
        <CardContent>
          <Notice>Nenhum servidor ativo foi encontrado para publicar a venda de Robux.</Notice>
        </CardContent>
      ) : (
        <form action={formAction}>
          <CardContent className="space-y-5 pt-5">
            <ActionFeedback state={state} />
            <input type="hidden" name="guildId" value={guildId} />

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Servidor" htmlFor={`${formId}-guild`} error={fieldError(state, "guildId")}>
                <Select
                  id={`${formId}-guild`}
                  value={guildId}
                  onChange={(event) => changeGuild(event.target.value)}
                >
                  {guilds.map((guild) => (
                    <option key={guild.id} value={guild.id}>{guild.name}</option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Canal da mensagem de Robux"
                htmlFor={`${formId}-channel`}
                hint="Pode ser diferente das vitrines de produtos"
                error={fieldError(state, "channelId")}
              >
                <div className="relative">
                  <Select
                    id={`${formId}-channel`}
                    name="channelId"
                    value={channelId}
                    onChange={(event) => setChannelId(event.target.value)}
                    className="pr-10"
                    required
                    disabled={!selectedGuild || Boolean(selectedGuild.channelLoadError)}
                  >
                    <option value="">Selecione um canal</option>
                    {selectedGuild?.channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.categoryName ? `${channel.categoryName} / ` : ""}#{channel.name}
                      </option>
                    ))}
                  </Select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
                  />
                </div>
                {selectedChannel ? (
                  <p className="mt-2 text-xs text-muted">
                    Canal reconhecido: <strong className="text-muted-strong">#{selectedChannel.name}</strong>
                  </p>
                ) : null}
              </Field>
            </div>

            {selectedGuild?.channelLoadError ? <Notice>{selectedGuild.channelLoadError}</Notice> : null}

            {replacesCatalogRobuxStorefront ? (
              <Notice>
                Esta publicação substituirá a vitrine antiga de produtos de Robux em
                <strong> #{replacesCatalogRobuxStorefront.channel_name}</strong>. O dropdown e o
                estoque sairão da mensagem; ficará apenas o botão de compra de Robux.
              </Notice>
            ) : null}

            <div className="grid gap-3 rounded-xl border border-success/20 bg-success/[0.045] p-4 text-sm md:grid-cols-3">
              <div>
                <p className="font-semibold text-foreground">Preço fixo</p>
                <p className="mt-1 text-xs leading-5 text-muted">1.000 Robux = R$ 35,00</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Pagamento seguro</p>
                <p className="mt-1 text-xs leading-5 text-muted">O valor é calculado no servidor; o Pix só é criado ao finalizar a compra.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Entrega organizada</p>
                <p className="mt-1 text-xs leading-5 text-muted">Um ticket privado abre automaticamente depois da confirmação.</p>
              </div>
            </div>

            {selectedGuild?.robux ? (
              <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-muted p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-success/20 bg-success/[0.07] text-success">
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Mensagem já publicada em #{selectedGuild.robux.channel_name}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Atualizada em {formatDateTime(selectedGuild.robux.published_at)}. Publicar de novo atualiza a mesma mensagem.
                  </p>
                </div>
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-5 text-muted">A mensagem de Robux não altera estoque, vitrine ou preços dos itens.</p>
            <Button
              type="submit"
              disabled={pending || !selectedGuild || !channelId || Boolean(selectedGuild.channelLoadError)}
            >
              {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-4" />}
              {pending ? "Publicando..." : selectedGuild?.robux ? "Atualizar mensagem" : "Publicar mensagem"}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

function findCatalogRobuxStorefront(
  guild: DiscordStorefrontGuildOption | null | undefined,
) {
  return guild?.current.find(
    (storefront) => storefront.catalog_store_name?.trim().toLocaleLowerCase("pt-BR") === "robux",
  ) ?? null;
}
