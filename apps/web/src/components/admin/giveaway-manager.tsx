"use client";

import { useActionState, useId, useMemo, useState } from "react";
import {
  CalendarClock,
  CircleX,
  Gift,
  LoaderCircle,
  PackagePlus,
  Plus,
  RefreshCw,
  Send,
  Ticket,
  Trash2,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";

import {
  cancelGiveawayAction,
  createGiveawayAction,
  republishGiveawayAction,
  rerollGiveawayWinnersAction,
} from "@/app/actions/giveaways";
import {
  ActionFeedback,
  fieldError,
  initialAdminActionState,
} from "@/components/admin/action-feedback";
import { formatDateTime } from "@/components/admin/admin-format";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/form-field";

export type GiveawayGuildOption = {
  id: string;
  name: string;
  discordGuildId: string;
  channels: Array<{ id: string; name: string; categoryName: string | null }>;
  categories: Array<{ id: string; name: string }>;
  error: string | null;
};

export type GiveawayProductOption = {
  id: string;
  name: string;
  stockQuantity: number;
  group: string;
};

export type GiveawayListItem = {
  id: string;
  publicSlug: string;
  title: string;
  guildName: string;
  status: "scheduled" | "active" | "drawing" | "completed" | "cancelled" | "failed";
  startsAt: string;
  endsAt: string;
  requiredValidInvites: number;
  participantCount: number;
  eligibleParticipantCount: number;
  publicationChannelName: string;
  publicationError: string | null;
  winnerDisplayName: string | null;
  winnerDiscordUserId: string | null;
  winners: Array<{
    id: string;
    position: number;
    displayName: string;
    discordUserId: string;
    ticketStatus: string;
    ticketChannelId: string | null;
    ticketError: string | null;
  }>;
  discordTicketStatus: string;
  discordTicketChannelId: string | null;
  failureReason: string | null;
  prizes: Array<{ productId: string; productName: string; quantity: number }>;
};

export function GiveawayManager({
  guilds,
  products,
  giveaways,
  defaultEndsAt,
}: {
  guilds: GiveawayGuildOption[];
  products: GiveawayProductOption[];
  giveaways: GiveawayListItem[];
  defaultEndsAt: string;
}) {
  const [state, formAction, pending] = useActionState(
    createGiveawayAction,
    initialAdminActionState,
  );
  const formId = useId();
  const [guildId, setGuildId] = useState(guilds[0]?.id ?? "");
  const [prizes, setPrizes] = useState([{
    key: `${formId}-prize-0`,
    productId: "",
    quantity: "1",
  }]);
  const guild = guilds.find((item) => item.id === guildId) ?? guilds[0];
  const selectedProductIds = useMemo(
    () => new Set(prizes.map((prize) => prize.productId).filter(Boolean)),
    [prizes],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.07] text-gold-bright">
              <PackagePlus aria-hidden="true" className="size-[18px]" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Novo sorteio</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Configure o pacote, os critérios de indicação, o anúncio e o ticket do ganhador.</p>
            </div>
          </div>
        </CardHeader>
        <form action={formAction}>
          <CardContent className="space-y-6 pt-5">
            <ActionFeedback state={state} />

            <div className="grid gap-5 lg:grid-cols-3">
              <Field label="Servidor" htmlFor={`${formId}-guild`} error={fieldError(state, "guildId")}>
                <Select id={`${formId}-guild`} name="guildId" value={guildId} onChange={(event) => setGuildId(event.target.value)} required>
                  {guilds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </Field>
              <Field label="Canal do anúncio" htmlFor={`${formId}-channel`} error={fieldError(state, "publicationChannelId")}>
                <Select id={`${formId}-channel`} name="publicationChannelId" defaultValue="" required key={`channel-${guildId}`}>
                  <option value="" disabled>Selecione um canal</option>
                  {guild?.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.categoryName ? `${channel.categoryName} / ` : ""}#{channel.name}</option>)}
                </Select>
              </Field>
              <Field label="Categoria do ticket" htmlFor={`${formId}-category`} hint="Opcional">
                <Select id={`${formId}-category`} name="ticketCategoryId" defaultValue="" key={`category-${guildId}`}>
                  <option value="">Sem categoria</option>
                  {guild?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
              </Field>
            </div>
            {guild?.error ? <p className="rounded-xl border border-danger/25 bg-danger/[0.07] p-3 text-sm text-[#ffc0bd]">{guild.error}</p> : null}

            <div className="grid gap-5 lg:grid-cols-2">
              <Field label="Título" htmlFor={`${formId}-title`} error={fieldError(state, "title")}>
                <Input id={`${formId}-title`} name="title" placeholder="Ex.: Pacote Grow a Garden" maxLength={120} required />
              </Field>
              <Field label="Encerramento" htmlFor={`${formId}-ends`} hint="Começa ao publicar · horário de Brasília" error={fieldError(state, "endsAt")}>
                <Input id={`${formId}-ends`} name="endsAt" type="datetime-local" defaultValue={defaultEndsAt} required />
              </Field>
              <Field label="Descrição" htmlFor={`${formId}-description`}>
                <Textarea id={`${formId}-description`} name="description" placeholder="Explique o sorteio e destaque o prêmio." maxLength={2000} />
              </Field>
              <Field label="Observações adicionais" htmlFor={`${formId}-rules`} hint="Não repita os critérios automáticos">
                <Textarea id={`${formId}-rules`} name="rulesText" placeholder="Ex.: contas alternativas serão desclassificadas. Idade, permanência e quantidade são configuradas abaixo." maxLength={2000} />
              </Field>
            </div>

            <div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Pacote de prêmios</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">Todos os itens abaixo vão para um único ganhador. O estoque é reservado ao criar.</p>
                </div>
                <Button type="button" variant="secondary" size="sm" disabled={prizes.length >= Math.min(products.length, 20)} onClick={() => setPrizes((current) => [...current, { key: crypto.randomUUID(), productId: "", quantity: "1" }])}>
                  <Plus aria-hidden="true" className="size-4" /> Adicionar item
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {prizes.map((prize, index) => (
                  <div key={prize.key} className="grid gap-3 rounded-xl border border-border bg-surface-muted p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
                    <Field label={`Produto ${index + 1}`} htmlFor={`${formId}-product-${prize.key}`}>
                      <Select id={`${formId}-product-${prize.key}`} name="prizeProductId" value={prize.productId} onChange={(event) => setPrizes((current) => current.map((item) => item.key === prize.key ? { ...item, productId: event.target.value } : item))} required>
                        <option value="" disabled>Selecione um produto</option>
                        {products.map((product) => <option key={product.id} value={product.id} disabled={product.id !== prize.productId && selectedProductIds.has(product.id)}>{product.group} · {product.name} ({formatNumber(product.stockQuantity)} em estoque)</option>)}
                      </Select>
                    </Field>
                    <Field label="Quantidade" htmlFor={`${formId}-quantity-${prize.key}`}>
                      <Input id={`${formId}-quantity-${prize.key}`} name="prizeQuantity" type="number" min={1} max={products.find((product) => product.id === prize.productId)?.stockQuantity ?? 10000} value={prize.quantity} onChange={(event) => setPrizes((current) => current.map((item) => item.key === prize.key ? { ...item, quantity: event.target.value } : item))} required />
                    </Field>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remover produto ${index + 1}`} disabled={prizes.length === 1} onClick={() => setPrizes((current) => current.filter((item) => item.key !== prize.key))}>
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {fieldError(state, "prizes") ? <p className="mt-2 text-xs text-danger">{fieldError(state, "prizes")}</p> : null}
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Indicações válidas" htmlFor={`${formId}-invites`} hint="Por participante" error={fieldError(state, "requiredValidInvites")}>
                <Input id={`${formId}-invites`} name="requiredValidInvites" type="number" min={0} max={100} defaultValue={1} required />
              </Field>
              <Field label="Idade mínima da conta" htmlFor={`${formId}-age`} hint="Dias" error={fieldError(state, "minimumAccountAgeDays")}>
                <Input id={`${formId}-age`} name="minimumAccountAgeDays" type="number" min={0} max={3650} defaultValue={7} required />
              </Field>
              <Field label="Permanência mínima" htmlFor={`${formId}-stay`} hint="Horas" error={fieldError(state, "minimumStayMinutes")}>
                <Input id={`${formId}-stay`} name="minimumStayHours" type="number" min={0} max={720} step="0.5" defaultValue={1} required />
              </Field>
            </div>
            <p className="rounded-xl border border-gold/20 bg-gold/[0.05] px-4 py-3 text-xs leading-5 text-muted">
              Depois de participar, o usuário cria um convite nativo pelo próprio Discord. O bot identifica quem criou o convite e contabiliza automaticamente as entradas que cumprirem estes critérios.
            </p>
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-muted">O sorteio começa assim que for criado e o pacote é reservado na mesma operação.</p>
            <Button type="submit" disabled={pending || !guild || products.length === 0}>
              {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
              {pending ? "Criando..." : "Criar e publicar"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold tracking-tight">Sorteios configurados</h2><p className="mt-1 text-sm text-muted">Acompanhe participantes, elegibilidade, ganhador e ticket.</p></div>
          <Badge>{giveaways.length}</Badge>
        </div>
        {giveaways.length === 0 ? (
          <Card><EmptyState icon={Gift} title="Nenhum sorteio ainda" description="Crie o primeiro sorteio pelo formulário acima." compact /></Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {giveaways.map((giveaway) => <GiveawayCard key={giveaway.id} giveaway={giveaway} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function GiveawayCard({ giveaway }: { giveaway: GiveawayListItem }) {
  const [cancelState, cancelAction, cancelling] = useActionState(cancelGiveawayAction, initialAdminActionState);
  const [publishState, publishAction, publishing] = useActionState(republishGiveawayAction, initialAdminActionState);
  const [rerollState, rerollAction, rerolling] = useActionState(rerollGiveawayWinnersAction, initialAdminActionState);
  const [selectedWinnerIds, setSelectedWinnerIds] = useState<string[]>([]);
  const canCancel = giveaway.status === "scheduled" || giveaway.status === "active" || giveaway.status === "drawing";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><GiveawayStatusBadge status={giveaway.status} /><span className="text-xs text-muted">#{giveaway.publicationChannelName}</span></div><h3 className="mt-3 truncate text-base font-semibold">{giveaway.title}</h3><p className="mt-1 text-xs text-muted">{giveaway.guildName}</p></div>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.07] text-gold"><Trophy aria-hidden="true" className="size-[18px]" /></span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric icon={Users} label="Participantes" value={formatNumber(giveaway.participantCount)} />
          <Metric icon={UserCheck} label="Elegíveis" value={formatNumber(giveaway.eligibleParticipantCount)} />
          <Metric icon={CalendarClock} label="Início" value={formatDateTime(giveaway.startsAt)} />
          <Metric icon={CalendarClock} label="Fim" value={formatDateTime(giveaway.endsAt)} />
        </div>
        <div className="rounded-xl border border-border bg-surface-muted p-3"><p className="text-xs font-semibold uppercase tracking-[.14em] text-muted">Pacote</p><ul className="mt-2 space-y-1 text-sm">{giveaway.prizes.map((prize) => <li key={prize.productId}><span className="font-semibold text-gold-bright">{formatNumber(prize.quantity)}×</span> {prize.productName}</li>)}</ul></div>
        {giveaway.winners.length ? (
          <div className="rounded-xl border border-gold/25 bg-gold/[0.06] p-3">
            <p className="flex items-center gap-2 text-xs text-muted">
              <Trophy aria-hidden="true" className="size-4 text-gold" />
              {giveaway.winners.length === 1 ? "Ganhador" : `${giveaway.winners.length} ganhadores`}
            </p>
            <ol className="mt-2 space-y-2">
              {giveaway.winners.map((winner) => (
                <li key={winner.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">
                    {winner.position}. {winner.displayName}
                    <span className="ml-1 font-mono text-xs font-normal text-muted">({winner.discordUserId})</span>
                  </span>
                  <span className={winner.ticketStatus === "open" ? "text-xs text-success" : winner.ticketStatus === "failed" ? "text-xs text-danger" : "text-xs text-warning"}>
                    {winner.ticketStatus === "open" ? `Ticket ${winner.ticketChannelId}` : winner.ticketStatus === "failed" ? "Ticket falhou; nova tentativa pendente" : "Ticket pendente"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : giveaway.winnerDiscordUserId ? <div className="flex items-center gap-3 rounded-xl border border-gold/25 bg-gold/[0.06] p-3"><Trophy aria-hidden="true" className="size-5 text-gold" /><div><p className="text-xs text-muted">Ganhador</p><p className="text-sm font-semibold">{giveaway.winnerDisplayName} <span className="font-mono text-xs font-normal text-muted">({giveaway.winnerDiscordUserId})</span></p></div></div> : null}
        {giveaway.status === "completed" && giveaway.winners.length ? (
          <form
            action={rerollAction}
            className="rounded-xl border border-warning/25 bg-warning/[0.05] p-3"
            onSubmit={(event) => {
              if (
                !window.confirm(
                  `Substituir ${selectedWinnerIds.length} ganhador(es)? Os tickets atuais dessas pessoas serão encerrados.`,
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="giveawayId" value={giveaway.id} />
            <p className="text-sm font-semibold">Resortear quem não apareceu</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              Marque exatamente quem deve ser substituído. Ganhadores atuais ou anteriores não podem ganhar novamente.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {giveaway.winners.map((winner) => (
                <label
                  key={winner.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="winnerId"
                    value={winner.id}
                    checked={selectedWinnerIds.includes(winner.id)}
                    onChange={(event) => {
                      setSelectedWinnerIds((current) => event.target.checked
                        ? [...current, winner.id]
                        : current.filter((id) => id !== winner.id));
                    }}
                    className="size-4 accent-[var(--color-gold)]"
                  />
                  <span className="min-w-0 truncate">
                    {winner.position}. {winner.displayName}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={rerolling || selectedWinnerIds.length === 0}
              >
                {rerolling
                  ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  : <RefreshCw aria-hidden="true" className="size-4" />}
                {rerolling
                  ? "Resorteando..."
                  : `Resortear ${selectedWinnerIds.length || ""}`.trim()}
              </Button>
            </div>
          </form>
        ) : null}
        {!giveaway.winners.length && giveaway.discordTicketChannelId ? <p className="flex items-center gap-2 text-sm text-success"><Ticket aria-hidden="true" className="size-4" /> Ticket aberto: <span className="font-mono">{giveaway.discordTicketChannelId}</span></p> : !giveaway.winners.length && giveaway.status === "completed" ? <p className="flex items-center gap-2 text-sm text-warning"><Ticket aria-hidden="true" className="size-4" /> Ticket: {giveaway.discordTicketStatus === "failed" ? "tentativa falhou; o cron tentará novamente" : "aguardando abertura"}</p> : null}
        {giveaway.publicationError ? <p className="rounded-xl border border-warning/25 bg-warning/[0.06] p-3 text-xs leading-5 text-[#f3c878]">Anúncio pendente: {giveaway.publicationError}</p> : null}
        {giveaway.failureReason ? <p className="rounded-xl border border-danger/25 bg-danger/[0.06] p-3 text-xs leading-5 text-[#ffc0bd]">{giveaway.failureReason}</p> : null}
        <ActionFeedback state={rerollState.message ? rerollState : cancelState.message ? cancelState : publishState} />
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        <LinkButton href={`/sorteios/${giveaway.publicSlug}`} target="_blank" variant="secondary" size="sm">Abrir página</LinkButton>
        <form action={publishAction}><input type="hidden" name="giveawayId" value={giveaway.id} /><Button type="submit" variant="secondary" size="sm" disabled={publishing}>{publishing ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-4" />} Atualizar anúncio</Button></form>
        {canCancel ? <form action={cancelAction}><input type="hidden" name="giveawayId" value={giveaway.id} /><Button type="submit" variant="danger" size="sm" disabled={cancelling}>{cancelling ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <CircleX aria-hidden="true" className="size-4" />} Cancelar</Button></form> : null}
      </CardFooter>
    </Card>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-surface-muted p-3"><Icon aria-hidden="true" className="size-4 text-gold" /><p className="mt-2 text-[10px] uppercase tracking-[.12em] text-muted">{label}</p><p className="mt-1 truncate text-xs font-semibold" title={value}>{value}</p></div>;
}

function GiveawayStatusBadge({ status }: { status: GiveawayListItem["status"] }) {
  const labels = { scheduled: "Agendado", active: "Ativo", drawing: "Sorteando", completed: "Concluído", cancelled: "Cancelado", failed: "Sem elegíveis" };
  const tones = { scheduled: "neutral", active: "success", drawing: "warning", completed: "gold", cancelled: "danger", failed: "danger" } as const;
  return <Badge tone={tones[status]}>{labels[status]}</Badge>;
}

function formatNumber(value: number) { return new Intl.NumberFormat("pt-BR").format(value); }
