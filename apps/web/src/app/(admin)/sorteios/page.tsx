import type { Metadata } from "next";

import { GiveawayManager, type GiveawayGuildOption } from "@/components/admin/giveaway-manager";
import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import { listDiscordGuildChannels } from "@/lib/bot/discord-storefront";
import { listProducts, listOperationalRows } from "@/lib/data/admin-repository";
import { listAdminGiveaways } from "@/lib/giveaways/repository";

export const metadata: Metadata = { title: "Sorteios" };

export default async function GiveawaysPage() {
  const [products, guildRows, giveaways] = await Promise.all([
    listProducts(),
    listOperationalRows("guilds", 200),
    listAdminGiveaways(),
  ]);
  const guilds = await Promise.all(
    guildRows
      .filter((guild) => guild.status === "active" && !guild.archived_at)
      .map(async (guild): Promise<GiveawayGuildOption> => {
        try {
          const channels = await listDiscordGuildChannels(guild.discord_guild_id);
          return {
            id: guild.id,
            name: guild.name,
            discordGuildId: guild.discord_guild_id,
            channels: channels.textChannels.map((channel) => ({
              id: channel.id,
              name: channel.name,
              categoryName: channel.categoryName,
            })),
            categories: channels.categories.map((category) => ({ id: category.id, name: category.name })),
            error: null,
          };
        } catch (error) {
          console.error(`[giveaways:discord-channels] ${error instanceof Error ? error.message : "erro desconhecido"}`);
          return {
            id: guild.id,
            name: guild.name,
            discordGuildId: guild.discord_guild_id,
            channels: [],
            categories: [],
            error: "Não foi possível carregar os canais deste servidor. Verifique as permissões do bot.",
          };
        }
      }),
  );
  const now = new Date();
  const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Engajamento" title="Sorteios" description="Crie um pacote de itens para um ganhador, valide indicações reais e abra o ticket de entrega automaticamente." />
      <Notice>Convites válidos usam autorização oficial do Discord: contas que já estavam no servidor, autoindicações, contas novas demais ou membros que saem antes do prazo não contam.</Notice>
      <GiveawayManager
        guilds={guilds}
        products={products
          .filter((product) => product.status === "active" && !product.archived_at && product.stock_quantity > 0)
          .map((product) => ({
            id: product.id,
            name: product.name,
            stockQuantity: product.stock_quantity,
            group: `${product.substores?.games?.name ?? "Jogo"} / ${product.substores?.name ?? "Loja"}`,
          }))}
        giveaways={giveaways.map((giveaway) => ({
          id: giveaway.id,
          publicSlug: giveaway.public_slug,
          title: giveaway.title,
          guildName: giveaway.guildName,
          status: giveaway.status,
          startsAt: giveaway.starts_at,
          endsAt: giveaway.ends_at,
          requiredValidInvites: giveaway.required_valid_invites,
          participantCount: giveaway.participantCount,
          eligibleParticipantCount: giveaway.eligibleParticipantCount,
          publicationChannelName: giveaway.publication_channel_name,
          publicationError: giveaway.publication_error,
          winnerDisplayName: giveaway.winner_display_name,
          winnerDiscordUserId: giveaway.winner_discord_user_id,
          winners: giveaway.winners.map((winner) => ({
            id: winner.id,
            position: winner.winner_position,
            displayName: winner.display_name,
            discordUserId: winner.discord_user_id,
            ticketStatus: winner.ticket_status,
            ticketChannelId: winner.ticket_channel_id,
            ticketError: winner.ticket_error,
          })),
          discordTicketStatus: giveaway.discord_ticket_status,
          discordTicketChannelId: giveaway.discord_ticket_channel_id,
          failureReason: giveaway.failure_reason,
          prizes: giveaway.prizes.map((prize) => ({ productId: prize.product_id, productName: prize.product_name, quantity: prize.quantity })),
        }))}
        defaultEndsAt={toDateTimeLocal(endsAt)}
      />
    </div>
  );
}

function toDateTimeLocal(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
