import type { Metadata } from "next";
import { DatabaseZap, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import {
  DiscordStorefrontForm,
  type DiscordStorefrontGuildOption,
} from "@/components/admin/discord-storefront-form";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  listDiscordTextChannels,
  readStorefrontConfiguration,
} from "@/lib/bot/discord-storefront";
import { readBoosterDiscountConfiguration } from "@/lib/bot/booster-discount";
import { getPlatformSettings, listOperationalRows } from "@/lib/data/admin-repository";

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
  const [settings, guildRows] = await Promise.all([
    getPlatformSettings(),
    listOperationalRows("guilds", 500),
  ]);
  const guilds = await Promise.all(
    guildRows
      .filter((guild) => guild.status === "active" && !guild.archived_at)
      .map(async (guild): Promise<DiscordStorefrontGuildOption> => {
        try {
          return {
            id: guild.id,
            discordGuildId: guild.discord_guild_id,
            name: guild.name,
            channels: await listDiscordTextChannels(guild.discord_guild_id),
            current: readStorefrontConfiguration(guild.configuration),
            boosterDiscount: readBoosterDiscountConfiguration(guild.configuration),
            channelLoadError: null,
          };
        } catch (error) {
          console.error(
            `[settings:discord-channels] ${error instanceof Error ? error.message : "erro desconhecido"}`,
          );
          return {
            id: guild.id,
            discordGuildId: guild.discord_guild_id,
            name: guild.name,
            channels: [],
            current: readStorefrontConfiguration(guild.configuration),
            boosterDiscount: readBoosterDiscountConfiguration(guild.configuration),
            channelLoadError:
              "Não foi possível carregar os canais. Confira se o bot está no servidor e possui acesso aos canais de texto.",
          };
        }
      }),
  );
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

      <DiscordStorefrontForm guilds={guilds} />
    </div>
  );
}
