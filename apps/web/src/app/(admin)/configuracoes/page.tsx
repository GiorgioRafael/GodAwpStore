import type { Metadata } from "next";
import { DatabaseZap, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getPlatformSettings } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Configurações" };

const securityRequirements = [
  {
    title: "Autenticação Discord",
    description: "OAuth e lista de IDs administrativos verificados no servidor.",
    icon: KeyRound,
  },
  {
    title: "Banco e armazenamento",
    description: "PostgreSQL, políticas RLS e bucket público de imagens no Supabase.",
    icon: DatabaseZap,
  },
  {
    title: "Proteção do estoque",
    description: "AES-256-GCM para conteúdo e HMAC separado para duplicidades.",
    icon: LockKeyhole,
  },
];

export default async function SettingsPage() {
  const settings = await getPlatformSettings();
  const parsedCommission = Number(settings?.global_commission_bps ?? 3_000);
  const globalCommissionBps = Number.isInteger(parsedCommission) ? parsedCommission : 3_000;
  const updatedAt = settings?.updated_at ?? null;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Sistema"
        title="Configurações globais"
        description="Defina regras comerciais e confira os requisitos de segurança do ambiente."
      />

      <Notice>
        Valores sensíveis devem ser preenchidos apenas no arquivo local de ambiente ou no provedor de hospedagem. Nunca cole chaves neste painel.
      </Notice>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,.95fr)]">
        <PlatformSettingsForm
          globalCommissionBps={globalCommissionBps}
          updatedAt={updatedAt}
        />

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Camadas de segurança</h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Requisitos obrigatórios antes de operar com dados reais.
                </p>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-success/20 bg-success/[0.06] text-success">
                <ShieldCheck aria-hidden="true" className="size-[18px]" />
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {securityRequirements.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-start gap-3 rounded-xl border border-border bg-surface-muted p-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-gold/15 bg-gold/[0.05] text-gold">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <Badge tone="neutral">Servidor</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
