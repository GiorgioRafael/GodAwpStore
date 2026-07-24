import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Gift,
  ShieldCheck,
  Trophy,
  UserPlus,
} from "lucide-react";

import { Brand } from "@/components/layout/brand";
import { ReferralLink } from "@/components/giveaways/referral-link";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getSiteUrl } from "@/lib/env";
import { giveawayEntryCookieName } from "@/lib/giveaways/oauth-state";
import { getPublicGiveaway, getServerTimestamp } from "@/lib/giveaways/repository";

export const metadata: Metadata = {
  title: "Sorteio",
  description: "Participe de um sorteio oficial da GWStore.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const SLUG_PATTERN = /^[a-z0-9]{12,32}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function GiveawayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query, cookieStore] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);
  if (!SLUG_PATTERN.test(slug)) notFound();
  const queryEntryToken = single(query.entrada);
  const cookieEntryToken = cookieStore.get(giveawayEntryCookieName(slug))?.value;
  const entryToken = queryEntryToken ?? cookieEntryToken;
  const referralToken = single(query.ref);
  const giveaway = await getPublicGiveaway(
    slug,
    entryToken && UUID_PATTERN.test(entryToken) ? entryToken : null,
  );
  if (!giveaway) notFound();

  const now = getServerTimestamp();
  const startsAt = Date.parse(giveaway.starts_at);
  const endsAt = Date.parse(giveaway.ends_at);
  const isOpen =
    (giveaway.status === "scheduled" || giveaway.status === "active") &&
    startsAt <= now &&
    endsAt > now;
  const isScheduled = giveaway.status === "scheduled" && startsAt > now;
  const isFinished = ["completed", "cancelled", "failed"].includes(giveaway.status);
  const validReferralToken = referralToken && UUID_PATTERN.test(referralToken)
    ? referralToken
    : null;
  const oauthUrl = `/api/sorteios/oauth/iniciar?${new URLSearchParams({
    slug,
    ...(validReferralToken ? { ref: validReferralToken } : {}),
  })}`;
  const errorMessage = giveawayError(single(query.erro));
  const inviteResult = single(query.convite);
  const participationResult = single(query.participacao);
  const feedback = errorMessage
    ? { tone: "danger" as const, message: errorMessage }
    : inviteResult
      ? {
          tone: "success" as const,
          message: inviteResult === "valido"
            ? "Convite validado! Sua entrada no servidor já contou para quem indicou você."
            : "Entrada confirmada. O convite será validado automaticamente após você concluir a verificação e permanecer no servidor pelo tempo exigido.",
        }
      : participationFeedback(participationResult);
  const referralUrl = giveaway.entry
    ? `${getSiteUrl()}/sorteios/${slug}?ref=${giveaway.entry.referralToken}`
    : null;
  const missingInvites = giveaway.entry
    ? Math.max(giveaway.required_valid_invites - giveaway.entry.validInviteCount, 0)
    : 0;

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(212,166,74,.14),transparent_36%),radial-gradient(circle_at_10%_75%,rgba(168,85,247,.08),transparent_28%)]" />
      <div className="relative mx-auto max-w-3xl space-y-6">
        <div className="flex justify-center"><Brand /></div>

        {feedback ? (
          <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${feedback.tone === "danger" ? "border-danger/30 bg-danger/10 text-[#ffc0bd]" : feedback.tone === "success" ? "border-success/30 bg-success/10 text-[#a7ebc0]" : "border-gold/30 bg-gold/10 text-gold-bright"}`}>
            {feedback.message}
          </div>
        ) : null}

        <Card className="overflow-hidden border-gold/20">
          <div className="h-1 bg-gradient-to-r from-fuchsia-500 via-gold to-amber-300" />
          <CardHeader className="pb-5 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-gold/25 bg-gold/10 text-gold-bright shadow-gold">
              <Gift aria-hidden="true" className="size-6" />
            </span>
            <div className="mt-4 flex justify-center">
              <Badge tone={giveaway.status === "completed" ? "gold" : isOpen ? "success" : isScheduled ? "neutral" : giveaway.status === "failed" || giveaway.status === "cancelled" ? "danger" : "warning"}>
                {statusLabel(giveaway.status, isOpen, isScheduled)}
              </Badge>
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-gold">{giveaway.guildName}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{giveaway.title}</h1>
            {giveaway.description ? <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted">{giveaway.description}</p> : null}
          </CardHeader>

          <CardContent className="space-y-6 border-t border-border">
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Trophy aria-hidden="true" className="size-4 text-gold" />
                {giveaway.winners.length > 1
                  ? `Prêmios para ${formatNumber(giveaway.winners.length)} ganhadores`
                  : "Pacote completo para 1 ganhador"}
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {giveaway.prizes.map((prize) => (
                  <div key={prize.product_id} className="rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm">
                    <span className="font-semibold text-gold-bright">{formatNumber(prize.quantity)}×</span> {prize.product_name}
                  </div>
                ))}
              </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
              <Info icon={CalendarClock} label="Início" value={formatDate(giveaway.starts_at)} />
              <Info icon={Clock3} label="Encerramento" value={formatDate(giveaway.ends_at)} />
            </div>

            <section className="rounded-2xl border border-border bg-surface-muted p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck aria-hidden="true" className="size-4 text-success" /> O que torna um convite válido</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                <li>• O participante precisa ter {formatNumber(giveaway.required_valid_invites)} convite(s) válido(s).</li>
                <li>• A pessoa convidada não pode já fazer parte do servidor.</li>
                <li>• A conta deve ter ao menos {formatNumber(giveaway.minimum_account_age_days)} dia(s).</li>
                <li>• Ela deve concluir a verificação e permanecer {formatDuration(giveaway.minimum_stay_minutes)} no servidor.</li>
              </ul>
              {giveaway.rules_text ? <p className="mt-4 border-t border-border pt-4 whitespace-pre-line text-sm leading-6 text-muted-strong">{giveaway.rules_text}</p> : null}
            </section>

            {giveaway.status === "completed" && giveaway.winners.length ? (
              <div className="rounded-2xl border border-gold/30 bg-gold/10 p-5">
                <Trophy aria-hidden="true" className="mx-auto size-7 text-gold-bright" />
                <p className="mt-2 text-center text-sm text-muted">
                  {giveaway.winners.length === 1 ? "Ganhador do pacote" : "Ganhadores"}
                </p>
                <ol className="mx-auto mt-3 max-w-md space-y-2">
                  {giveaway.winners.map((winner) => (
                    <li key={winner.id} className="flex items-center justify-between gap-3 rounded-xl border border-gold/20 bg-black/10 px-3 py-2">
                      <span className="font-semibold">
                        {winner.winner_position}. {winner.display_name}
                      </span>
                      <span className="font-mono text-xs text-muted">{winner.discord_user_id}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {giveaway.entry ? (
              <section className="rounded-2xl border border-success/25 bg-success/[0.06] p-5">
                <h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 aria-hidden="true" className="size-5 text-success" /> Participação confirmada</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {giveaway.entry.displayName}, você possui <strong className="text-foreground">{formatNumber(giveaway.entry.validInviteCount)}</strong> de <strong className="text-foreground">{formatNumber(giveaway.required_valid_invites)}</strong> convite(s) válido(s).
                  {missingInvites > 0 ? ` Faltam ${formatNumber(missingInvites)}.` : " Você já está elegível para o sorteio."}
                </p>
                {referralUrl && isOpen ? <div className="mt-4"><ReferralLink url={referralUrl} /></div> : null}
              </section>
            ) : isOpen ? (
              <div className="rounded-2xl border border-border bg-surface-muted p-5 text-center">
                <h2 className="font-semibold">
                  {participationResult === "nao_cadastrado"
                    ? "Você ainda não está participando"
                    : "Status da participação"}
                </h2>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
                  {participationResult === "nao_cadastrado"
                    ? "Seu Discord foi identificado, mas ainda não existe uma inscrição neste sorteio."
                    : "Identifique seu Discord para consultar sua inscrição ou entrar no sorteio."}
                </p>
                <LinkButton href={oauthUrl} size="lg" className="mt-4 w-full sm:w-auto">
                  <UserPlus aria-hidden="true" className="size-5" />
                  {validReferralToken ? "Entrar e validar convite" : "Participar com Discord"}
                </LinkButton>
                <p className="mt-3 text-xs leading-5 text-muted">A autorização identifica sua conta e, em links de indicação, adiciona você ao servidor oficial. Sua senha nunca é compartilhada.</p>
              </div>
            ) : !isFinished ? (
              <p className="text-center text-sm text-muted">As participações ainda não estão abertas ou estão sendo encerradas.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted p-3.5"><span className="grid size-9 place-items-center rounded-lg bg-white/[0.04] text-gold"><Icon aria-hidden="true" className="size-4" /></span><div><p className="text-xs text-muted">{label}</p><p className="mt-0.5 text-sm font-medium">{value}</p></div></div>;
}

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function statusLabel(status: string, isOpen: boolean, isScheduled: boolean) {
  if (isOpen) return "Participações abertas";
  if (isScheduled) return "Agendado";
  if (status === "completed") return "Sorteio encerrado";
  if (status === "cancelled") return "Cancelado";
  if (status === "failed") return "Encerrado sem elegíveis";
  return "Processando resultado";
}

function giveawayError(code?: string) {
  const messages: Record<string, string> = {
    link_invalido: "Este link de sorteio ou indicação não é válido.",
    fora_do_periodo: "Este sorteio não está aceitando participações agora.",
    configuracao: "A participação por Discord ainda não está configurada.",
    sessao_expirada: "A autorização expirou. Tente participar novamente.",
    membro_necessario: "Conclua a entrada e a verificação no servidor antes de participar.",
    ja_era_membro: "Esse convite não pode ser validado porque você já fazia parte do servidor.",
    conta_recente: "Sua conta Discord ainda não tem a idade mínima exigida.",
    ja_atribuido: "Sua entrada já foi atribuída a outro convite deste sorteio.",
    convite_invalido: "Este convite já foi utilizado ou deixou de ser válido para esta conta.",
    indisponivel: "Não foi possível concluir agora. Tente novamente em alguns instantes.",
  };
  return code ? messages[code] ?? messages.indisponivel : null;
}

function participationFeedback(result?: string) {
  if (result === "cadastrado") {
    return { tone: "success" as const, message: "Participação cadastrada com sucesso!" };
  }
  if (result === "ja_cadastrado") {
    return { tone: "success" as const, message: "Você já está cadastrado neste sorteio." };
  }
  if (result === "nao_cadastrado") {
    return { tone: "neutral" as const, message: "Você ainda não está cadastrado neste sorteio." };
  }
  return null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function formatDuration(minutes: number) {
  if (minutes === 0) return "até concluir a verificação";
  if (minutes % 1_440 === 0) return `${formatNumber(minutes / 1_440)} dia(s)`;
  if (minutes % 60 === 0) return `${formatNumber(minutes / 60)} hora(s)`;
  return `${formatNumber(minutes)} minuto(s)`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}
