import type { Metadata } from "next";
import { DatabaseZap, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import { CatalogStoresManager } from "@/components/admin/catalog-stores-manager";
import {
  DiscordStorefrontForm,
  type DiscordStorefrontGuildOption,
} from "@/components/admin/discord-storefront-form";
import { PlatformSettingsForm } from "@/components/admin/platform-settings-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  listDiscordTextChannels,
  readStorefrontConfigurations,
} from "@/lib/bot/discord-storefront";
import { readBoosterDiscountConfiguration } from "@/lib/bot/booster-discount";
import {
  getPlatformSettings,
  listCatalogStores,
  listGames,
  listOperationalRows,
  listProducts,
  listSubstores,
} from "@/lib/data/admin-repository";

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
  const [settings, guildRows, gameRows, catalogStoreRows, substoreRows, productRows] = await Promise.all([
    getPlatformSettings(),
    listOperationalRows("guilds", 500),
    listGames(),
    listCatalogStores(),
    listSubstores(),
    listProducts(),
  ]);
  const activeGameIds = new Set(
    gameRows
      .filter((game) => game.status === "active" && !game.archived_at)
      .map((game) => game.id),
  );
  const storefrontGames = catalogStoreRows
    .filter(
      (store) =>
        store.status === "active" && !store.archived_at && activeGameIds.has(store.game_id),
    )
    .map((store) => {
      const activeSubstores = substoreRows.filter(
        (substore) =>
          substore.game_id === store.game_id &&
          substore.status === "active" &&
          !substore.archived_at,
      );
      const substoreIds = new Set(activeSubstores.map((substore) => substore.id));
      return {
        id: store.id,
        name: store.name,
        gameId: store.game_id,
        gameName: store.games?.name ?? "Jogo",
        categoryCount: activeSubstores.length,
        productCount: productRows.filter(
          (product) =>
            product.catalog_store_id === store.id &&
            substoreIds.has(product.substore_id) &&
            product.status === "active" &&
            !product.archived_at,
        ).length,
      };
    });
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
            current: readStorefrontConfigurations(guild.configuration),
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
            current: readStorefrontConfigurations(guild.configuration),
            boosterDiscount: readBoosterDiscountConfiguration(guild.configuration),
            channelLoadError:
              "Não foi possível carregar os canais. Confira se o bot está no servidor e possui acesso aos canais de texto.",
          };
        }
      }),
  );
  const parsedCommission = Number(settings?.global_commission_bps ?? 200);
  const globalCommissionBps = Number.isInteger(parsedCommission) ? parsedCommission : 200;
  const parsedUpsellDiscount = Number(settings?.upsell_discount_bps ?? 500);
  const upsellDiscountBps = Number.isInteger(parsedUpsellDiscount)
    ? Math.min(Math.max(parsedUpsellDiscount, 1), 500)
    : 500;
  const upsellStrategy =
    settings?.upsell_strategy === "best_seller" ||
    settings?.upsell_strategy === "same_product"
      ? settings.upsell_strategy
      : "automatic";
  const parsedLeadRecoveryDiscount = Number(
    settings?.lead_recovery_discount_bps ?? 500,
  );
  const leadRecoveryDiscountBps = Number.isInteger(parsedLeadRecoveryDiscount)
    ? Math.min(Math.max(parsedLeadRecoveryDiscount, 1), 500)
    : 500;
  const parsedLeadRecoveryDelay = Number(
    settings?.lead_recovery_delay_minutes ?? 15,
  );
  const leadRecoveryDelayMinutes = Number.isInteger(parsedLeadRecoveryDelay)
    ? Math.min(Math.max(parsedLeadRecoveryDelay, 0), 1_440)
    : 15;
  const updatedAt = settings?.updated_at ?? null;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Sistema"
        title="Configurações da loja"
        description="Crie lojas ou mundos independentes, publique seus canais e ajuste as regras gerais do bot."
      />

      <Notice>
        Valores sensíveis devem ser preenchidos apenas no arquivo local de ambiente ou no provedor de hospedagem. Nunca cole chaves neste painel.
      </Notice>

      <CatalogStoresManager
        stores={catalogStoreRows
          .filter(
            (store) =>
              store.status === "active" &&
              !store.archived_at &&
              activeGameIds.has(store.game_id),
          )
          .map((store) => ({
            id: store.id,
            gameId: store.game_id,
            gameName: store.games?.name ?? "Jogo",
            name: store.name,
            isDefault: store.is_default,
            productCount: productRows.filter((product) => product.catalog_store_id === store.id).length,
          }))}
        games={gameRows
          .filter((game) => game.status === "active" && !game.archived_at)
          .map((game) => ({ id: game.id, name: game.name }))}
        guilds={guildRows
          .filter((guild) => guild.status === "active" && !guild.archived_at)
          .map((guild) => ({ id: guild.id, name: guild.name }))}
      />

      <DiscordStorefrontForm guilds={guilds} games={storefrontGames} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,.95fr)]">
        <PlatformSettingsForm
          globalCommissionBps={globalCommissionBps}
          upsellEnabled={settings?.upsell_enabled ?? true}
          upsellDiscountBps={upsellDiscountBps}
          upsellStrategy={upsellStrategy}
          leadRecoveryEnabled={settings?.lead_recovery_enabled ?? true}
          leadRecoveryDiscountBps={leadRecoveryDiscountBps}
          leadRecoveryDelayMinutes={leadRecoveryDelayMinutes}
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
