"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { LoaderCircle, MessageSquareText, Pin, RefreshCw, ShieldCheck } from "lucide-react";

import { publishDiscordStorefrontAction } from "@/app/actions/admin";
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
import type {
  DiscordStorefrontChannel,
  DiscordStorefrontConfiguration,
} from "@/lib/bot/discord-storefront";

export type DiscordStorefrontGuildOption = {
  id: string;
  discordGuildId: string;
  name: string;
  channels: DiscordStorefrontChannel[];
  current: DiscordStorefrontConfiguration | null;
  channelLoadError: string | null;
};

export function DiscordStorefrontForm({
  guilds,
}: {
  guilds: DiscordStorefrontGuildOption[];
}) {
  const initialGuild = guilds.find((guild) => guild.current) ?? guilds[0] ?? null;
  const [selectedGuildId, setSelectedGuildId] = useState(initialGuild?.id ?? "");
  const [selectedChannelId, setSelectedChannelId] = useState(
    preferredChannelId(initialGuild),
  );
  const [state, formAction, pending] = useActionState(
    publishDiscordStorefrontAction,
    initialAdminActionState,
  );
  const formId = useId();
  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) ?? null,
    [guilds, selectedGuildId],
  );

  function changeGuild(guildId: string) {
    const guild = guilds.find((item) => item.id === guildId) ?? null;
    setSelectedGuildId(guildId);
    setSelectedChannelId(preferredChannelId(guild));
  }

  const canPublish = Boolean(selectedGuild && selectedChannelId && !selectedGuild.channelLoadError);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">Vitrine fixa no Discord</h2>
              <Badge tone="gold">Bot</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Escolha o canal onde o bot publicará e fixará a lista de produtos com estoque.
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
            Nenhum servidor ativo foi registrado ainda. Use <strong>/loja</strong> no servidor
            autorizado para o bot reconhecê-lo e volte a esta tela.
          </Notice>
        </CardContent>
      ) : (
        <form action={formAction}>
          <CardContent className="space-y-5 pt-5">
            <ActionFeedback state={state} />
            <input type="hidden" name="guildId" value={selectedGuildId} />

            <div className="grid gap-5 lg:grid-cols-2">
              <Field
                label="Servidor Discord"
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
                label="Canal da loja"
                htmlFor={`${formId}-channel`}
                hint="Canal de texto"
                error={fieldError(state, "channelId")}
              >
                <Select
                  id={`${formId}-channel`}
                  name="channelId"
                  value={selectedChannelId}
                  onChange={(event) => setSelectedChannelId(event.target.value)}
                  disabled={!selectedGuild || selectedGuild.channels.length === 0}
                  required
                >
                  {selectedGuild?.channels.length ? null : (
                    <option value="">Nenhum canal disponível</option>
                  )}
                  {selectedGuild?.channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.categoryName ? `${channel.categoryName} / ` : ""}#{channel.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {selectedGuild?.channelLoadError ? (
              <Notice>{selectedGuild.channelLoadError}</Notice>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <FlowItem
                icon={MessageSquareText}
                title="Lista no canal"
                description="O bot publica todos os produtos disponíveis em um dropdown."
              />
              <FlowItem
                icon={ShieldCheck}
                title="Compra privada"
                description="Detalhes, botão de compra e pagamento aparecem só para o cliente."
              />
              <FlowItem
                icon={Pin}
                title="Mensagem fixa"
                description="Ao salvar novamente, a vitrine atual é atualizada sem duplicar."
              />
            </div>

            {selectedGuild?.current ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted p-3.5 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    Publicada em #{selectedGuild.current.channel_name}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Última atualização: {formatDateTime(selectedGuild.current.published_at)}
                  </p>
                </div>
                <Badge tone={selectedGuild.current.pinned ? "success" : "warning"}>
                  {selectedGuild.current.pinned ? "Fixada" : "Não fixada"}
                </Badge>
              </div>
            ) : null}
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
                : selectedGuild?.current
                  ? "Atualizar vitrine"
                  : "Publicar e fixar"}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

function preferredChannelId(guild: DiscordStorefrontGuildOption | null) {
  if (!guild) return "";
  const currentId = guild.current?.channel_id;
  return guild.channels.some((channel) => channel.id === currentId)
    ? currentId ?? ""
    : guild.channels[0]?.id ?? "";
}

function FlowItem({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof MessageSquareText;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-surface-muted p-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-gold/15 bg-gold/[0.05] text-gold">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      </div>
    </div>
  );
}
