import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  synchronizePublishedDiscordStorefronts,
  type DiscordStorefrontSyncResult,
} from "./discord-storefront-sync";

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

const MAXIMUM_DRAIN_PASSES = 3;
const CLAIM_BATCH_SIZE = 1_000;

export type DiscordStorefrontSyncQueueRepository = {
  request(orderId: string): Promise<boolean>;
  claim(claimToken: string): Promise<number>;
  complete(input: {
    claimToken: string;
    success: boolean;
    error: string | null;
  }): Promise<boolean>;
};

export class SupabaseDiscordStorefrontSyncQueueRepository
  implements DiscordStorefrontSyncQueueRepository
{
  constructor(private readonly client: AdminClient = requireClient()) {}

  async request(orderId: string) {
    const { data, error } = await this.client.rpc(
      "request_discord_storefront_sync",
      { p_order_id: orderId },
    );
    assertQuery(error, "solicitação de sincronização da vitrine");
    return data;
  }

  async claim(claimToken: string) {
    const { data, error } = await this.client.rpc(
      "claim_discord_storefront_sync",
      {
        p_claim_token: claimToken,
        p_batch_size: CLAIM_BATCH_SIZE,
      },
    );
    assertQuery(error, "reserva de sincronização da vitrine");
    return data;
  }

  async complete(input: {
    claimToken: string;
    success: boolean;
    error: string | null;
  }) {
    const { data, error } = await this.client.rpc(
      "complete_discord_storefront_sync",
      {
        p_claim_token: input.claimToken,
        p_success: input.success,
        p_error: input.error,
      },
    );
    assertQuery(error, "conclusão da sincronização da vitrine");
    return data;
  }
}

export async function requestDiscordStorefrontSync(
  orderId: string,
  repository: DiscordStorefrontSyncQueueRepository =
    new SupabaseDiscordStorefrontSyncQueueRepository(),
) {
  return repository.request(orderId);
}

export async function drainDiscordStorefrontSyncQueue(
  dependencies: {
    repository?: DiscordStorefrontSyncQueueRepository;
    synchronize?: () => Promise<DiscordStorefrontSyncResult>;
  } = {},
) {
  const repository =
    dependencies.repository ??
    new SupabaseDiscordStorefrontSyncQueueRepository();
  const synchronize =
    dependencies.synchronize ?? synchronizePublishedDiscordStorefronts;
  let claimed = 0;
  let passes = 0;
  let published = 0;

  while (passes < MAXIMUM_DRAIN_PASSES) {
    const claimToken = crypto.randomUUID();
    const batchSize = await repository.claim(claimToken);
    if (batchSize === 0) break;

    passes += 1;
    claimed += batchSize;
    try {
      const result = await synchronize();
      if (result.failed > 0) {
        throw new Error(
          `${result.failed} vitrine(s) não foram sincronizadas.`,
        );
      }
      const completed = await repository.complete({
        claimToken,
        success: true,
        error: null,
      });
      if (!completed) {
        throw new Error("A reserva da sincronização da vitrine expirou.");
      }
      published += result.published;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "erro desconhecido";
      await repository
        .complete({
          claimToken,
          success: false,
          error: message,
        })
        .catch(() => undefined);
      throw error;
    }
  }

  return { claimed, passes, published };
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}

function assertQuery(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) throw new Error(`Falha na ${operation}.`);
}
