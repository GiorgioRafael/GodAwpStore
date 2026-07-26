/** @jsxImportSource chat */

import { Card, CardText, Divider, type ChatElement } from "chat";

import { STORE_NAME_UPPER } from "@/lib/brand";

import type { CustomerRankProgress } from "./customer-rank";

export function customerRankCard(progress: CustomerRankProgress): ChatElement {
  const current = progress.currentRank;
  const next = progress.nextRank;

  return (
    <Card
      title={`🏆 SEU RANKING • ${STORE_NAME_UPPER}`}
      subtitle="O nível é calculado somente com pagamentos LivePix confirmados neste servidor."
    >
      <CardText>
        💰 **Total gasto:** {formatBrl(progress.totalSpentCents)}
      </CardText>
      <CardText>
        {current
          ? `${current.roleName} • **${formatPercentage(current.discountBps)} de desconto**`
          : "🔰 **Ranking atual:** ainda sem ranking"}
      </CardText>
      <Divider />
      {next ? (
        <>
          <CardText>🎯 **Próximo nível:** {next.roleName}</CardText>
          <CardText>
            {progressBar(progress)} **Faltam {formatBrl(progress.amountToNextRankCents)}**
          </CardText>
          <CardText>
            Ao alcançar esse nível, seu desconto será de **{formatPercentage(next.discountBps)}**.
          </CardText>
        </>
      ) : (
        <CardText>
          💎 **Nível máximo alcançado!** Você já recebe o maior desconto disponível.
        </CardText>
      )}
      <Divider />
      <CardText>
        🧾 O desconto entra automaticamente no próximo pedido e o total final respeita o mínimo de **R$ 1,00** da LivePix.
      </CardText>
    </Card>
  );
}

export function customerRankUnavailableCard(): ChatElement {
  return (
    <Card
      title="⚠️ RANKING INDISPONÍVEL"
      subtitle="Não conseguimos consultar seu progresso agora."
    >
      <CardText>Tente novamente em alguns instantes usando **/rank**.</CardText>
    </Card>
  );
}

export function customerRankGuideCard(): ChatElement {
  return (
    <Card
      title={`🏆 SISTEMA DE RANKING • ${STORE_NAME_UPPER}`}
      subtitle="Seu cargo e desconto evoluem automaticamente conforme o total pago neste servidor."
    >
      <CardText>
        🥉 **Bronze — 1% de desconto**{"\n"}
        `Bronze I · R$ 5` · `Bronze II · R$ 15` · `Bronze III · R$ 30`
      </CardText>
      <CardText>
        🥈 **Prata — 2% de desconto**{"\n"}
        `Prata I · R$ 50` · `Prata II · R$ 80` · `Prata III · R$ 120`
      </CardText>
      <CardText>
        🥇 **Ouro — 5% de desconto**{"\n"}
        `Ouro I · R$ 250` · `Ouro II · R$ 400` · `Ouro III · R$ 600`{"\n"}
        `Ouro IV · R$ 800` · `Ouro V · R$ 1.000`
      </CardText>
      <CardText>
        💎 **Diamond — 10% de desconto**{"\n"}
        `Diamond I · R$ 1.500` · `Diamond II · R$ 2.000`{"\n"}
        `Diamond III · R$ 3.000` · `Diamond IV · R$ 4.000` · `Diamond V · R$ 5.000`
      </CardText>
      <Divider />
      <CardText>
        Use **/rank** para consultar seu total gasto, seu desconto atual e quanto falta para o próximo nível.
      </CardText>
      <CardText>
        O desconto é aplicado automaticamente nas próximas compras. Só contam pagamentos LivePix confirmados neste servidor, e o valor final sempre respeita o mínimo de **R$ 1,00**.
      </CardText>
    </Card>
  );
}

function progressBar(progress: CustomerRankProgress) {
  const next = progress.nextRank;
  if (!next) return "`██████████`";
  const start = progress.currentRank?.minimumSpendCents ?? 0;
  const distance = Math.max(1, next.minimumSpendCents - start);
  const advanced = Math.min(distance, Math.max(0, progress.totalSpentCents - start));
  const filled = Math.min(10, Math.max(0, Math.floor((advanced / distance) * 10)));
  return `\`${"█".repeat(filled)}${"░".repeat(10 - filled)}\``;
}

function formatBrl(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatPercentage(bps: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(bps / 100) + "%";
}
