"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Gem, LoaderCircle, MessageSquareText, RefreshCw, ShieldCheck, Waypoints } from "lucide-react";

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

export type DiscordStorefrontGuildOption = {
  id: string;
  discordGuildId: string;
  name: string;
  channels: DiscordStorefrontChannel[];
  current: DiscordStorefrontConfiguration | null;
  boosterDiscount: BoosterDiscountConfiguration;
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

  function changeGuild(guildId: string) {
    const guild = guilds.find((item) => item.id === guildId) ?? null;
    setSelectedGuildId(guildId);
    setSelectedChannelId(preferredChannelId(guild));
    const discount = discountFormValues(guild);
    setBoosterDiscountEnabled(discount.enabled);
    setBoosterDiscountPercent(discount.percent);
    setBoosterMinimumSubtotal(discount.minimum);
  }

  const canPublish = Boolean(selectedGuild && selectedChannelId && !selectedGuild.channelLoadError);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">Vitrine no Discord</h2>
              <Badge tone="gold">Bot</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Escolha o canal onde o bot publicará a lista de produtos com estoque.
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

            <div className="space-y-4 rounded-xl border border-gold/20 bg-gold/[0.035] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-gold/20 bg-gold/[0.08] text-gold">
                    <Gem aria-hidden="true" className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Desconto para Nitro Boosters</p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      O bot confirma o boost diretamente no servidor antes de calcular o Pix.
                    </p>
                  </div>
                </div>
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
                  label="Compra mínima para desconto"
                  htmlFor={`${formId}-booster-minimum`}
                  hint="Subtotal antes do desconto"
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
              <p className="text-xs leading-5 text-muted">
                Regra inicial: <strong>5% acima de R$ 50,00</strong>. O subtotal, o desconto e o total final ficam registrados no pedido.
              </p>
            </div>

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
                icon={Waypoints}
                title="Canal alterável"
                description="Troque o canal quando quiser; a vitrine é movida sem duplicar."
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
                <Badge tone="success">Publicada</Badge>
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
                  ? "Salvar e atualizar"
                  : "Salvar e publicar"}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
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
