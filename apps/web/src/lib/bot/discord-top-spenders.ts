import "server-only";

import { IS_GWSTORE } from "@/lib/brand";
import { assertConfiguredDiscordBotIdentity, discordBotJson, discordBotRequest, DiscordApiError } from "./discord-api";
import { GWSTORE_RANKING_CHANNEL_ID, GWSTORE_RANKING_GUILD_ID, TOP_SPENDERS_TITLE,
  rankTopSpenders, topSpendersMessage } from "./customer-top-spenders";
import { SupabaseTopSpendersRepository, type TopSpendersRepository } from "./customer-top-spenders-repository";

type Message = {
  id: string;
  author: { id: string };
  channel_id: string;
  pinned: boolean;
  embeds?: Array<{ title?: string; description?: string; color?: number; footer?: { text?: string } }>;
  type?: number;
  message_reference?: { message_id?: string };
};

export async function synchronizeGwStoreTopSpenders(dependencies: {
  repository?: TopSpendersRepository;
  fetcher?: typeof fetch;
} = {}) {
  if (!IS_GWSTORE) return { status: "disabled" };
  const repository = dependencies.repository ?? new SupabaseTopSpendersRepository();
  const guild = await repository.findGuild();
  if (!guild) return { status: "disabled" };
  const fetcher = dependencies.fetcher ?? fetch;
  const claimToken = crypto.randomUUID();
  if (!await repository.claim(guild.id, claimToken)) return { status: "busy" };
  try {
    // Read under the lease, so a slower worker cannot overwrite a newer ranking.
    const leaders = rankTopSpenders(guild.id, await repository.listPaidPurchases(guild.id));
    const botId = await assertConfiguredDiscordBotIdentity(fetcher);
    const channel = await discordBotJson<{ guild_id: string; type: number }>(
      `/channels/${GWSTORE_RANKING_CHANNEL_ID}`, {}, fetcher,
    );
    if (channel.guild_id !== GWSTORE_RANKING_GUILD_ID || channel.type !== 0) {
      throw new Error("Canal do Top 5 não pertence ao servidor GWStore.");
    }
    // Mentions of former members render as raw IDs in Discord. Public profile
    // names keep the historical ranking readable without excluding purchases.
    const namedLeaders = await Promise.all(leaders.map(async (leader) => {
      const user = await discordBotJson<{ id: string; global_name?: string | null; username?: string }>(
        `/users/${leader.buyerDiscordId}`, {}, fetcher,
      ).catch(() => null);
      const displayName = user?.id === leader.buyerDiscordId
        ? user.global_name?.trim() || user.username?.trim() || null : null;
      return { ...leader, displayName };
    }));
    const configuration = guild.configuration;
    const savedId = typeof configuration === "object" && configuration !== null &&
      !Array.isArray(configuration) ? configuration.customer_top_spenders_message_id : null;
    let previous: Message | null = null;
    if (typeof savedId === "string" && /^[0-9]{15,22}$/.test(savedId)) {
      try {
        previous = await discordBotJson<Message>(`/channels/${GWSTORE_RANKING_CHANNEL_ID}/messages/${savedId}`, {}, fetcher);
        if (!isRankingMessage(previous, botId)) throw new Error("Mensagem salva não é o Top 5 deste bot.");
      } catch (error) {
        if (!(error instanceof DiscordApiError) || error.status !== 404 || error.discordCode !== 10008) throw error;
      }
    }
    // Recover a successful Discord POST after a timeout or failed database save.
    // Scan the entire channel, or fail closed; never guess that an older post is absent.
    if (!previous) previous = await findRankingMessage(botId, fetcher);
    const payload = topSpendersMessage(namedLeaders);
    let message = previous;
    if (!message) {
      message = await discordBotJson<Message>(`/channels/${GWSTORE_RANKING_CHANNEL_ID}/messages`, {
        method: "POST", body: JSON.stringify({ ...payload, nonce: `top5:${GWSTORE_RANKING_CHANNEL_ID}`, enforce_nonce: true }),
        signal: AbortSignal.timeout(15_000),
      }, fetcher);
    } else if (!sameRankingContent(message, payload)) {
      message = await discordBotJson<Message>(`/channels/${GWSTORE_RANKING_CHANNEL_ID}/messages/${message.id}`, {
        method: "PATCH", body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      }, fetcher);
    }
    if (!isRankingMessage(message, botId)) throw new Error("Discord retornou uma mensagem inválida para o Top 5.");
    if (savedId !== message.id) await repository.saveMessage(guild, message.id);
    if (!message.pinned) {
      const pin = await discordBotRequest(`/channels/${GWSTORE_RANKING_CHANNEL_ID}/messages/pins/${message.id}`, {
        method: "PUT", signal: AbortSignal.timeout(15_000),
      }, fetcher);
      if (!pin.ok) throw new Error(`Não foi possível fixar o Top 5 (${pin.status}).`);
    }
    // Discord may add a system notice for the pin. Remove only this bot's own
    // notices referring to the ranking, leaving exactly one ranking post.
    const recent = await discordBotJson<Message[]>(`/channels/${GWSTORE_RANKING_CHANNEL_ID}/messages?limit=100`, {}, fetcher);
    for (const notice of recent) {
      if (notice.type === 6 && notice.author.id === botId && notice.message_reference?.message_id === message.id) {
        const removal = await discordBotRequest(`/channels/${GWSTORE_RANKING_CHANNEL_ID}/messages/${notice.id}`, { method: "DELETE" }, fetcher);
        if (!removal.ok && removal.status !== 404) throw new Error("Não foi possível remover o aviso de fixação do Top 5.");
      }
    }
    await repository.release(guild.id, claimToken, true);
    return { status: "updated", customers: leaders.length, messageId: message.id };
  } catch (error) {
    await repository.release(guild.id, claimToken, false).catch(() => undefined);
    throw error;
  }
}

function isRankingMessage(message: Message, botId: string) {
  return /^[0-9]{15,22}$/.test(message.id) && message.channel_id === GWSTORE_RANKING_CHANNEL_ID &&
    message.author?.id === botId && message.embeds?.[0]?.title === TOP_SPENDERS_TITLE;
}

function sameRankingContent(message: Message, payload: ReturnType<typeof topSpendersMessage>) {
  const previous = message.embeds?.[0];
  const next = payload.embeds[0];
  return previous?.title === next.title && previous.description === next.description &&
    previous.color === next.color && previous.footer?.text === next.footer.text;
}

async function findRankingMessage(botId: string, fetcher: typeof fetch) {
  let before = "";
  let found: Message | null = null;
  for (let page = 0; page < 10; page++) {
    const messages = await discordBotJson<Message[]>(
      `/channels/${GWSTORE_RANKING_CHANNEL_ID}/messages?limit=100${before ? `&before=${before}` : ""}`, {}, fetcher,
    );
    for (const message of messages) if (isRankingMessage(message, botId)) {
      if (found) throw new Error("Há mais de uma mensagem de Top 5 neste canal.");
      found = message;
    }
    if (messages.length < 100) return found;
    before = messages.at(-1)!.id;
  }
  throw new Error("O canal do Top 5 contém mensagens demais para uma recuperação segura.");
}
