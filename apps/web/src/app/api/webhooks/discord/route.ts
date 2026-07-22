import { after } from "next/server";
import { verifyKey } from "discord-interactions";

import {
  completeDiscordQuantityPurchase,
  createNativeDiscordQuantityResponse,
  getDiscordBot,
  parseNativeDiscordQuantityInteraction,
} from "@/lib/bot/discord-bot";
import {
  completeDiscordCartPurchase,
  createNativeDiscordCartReviewResponse,
  createNativeDiscordCartResponse,
  parseNativeDiscordCartInteraction,
} from "@/lib/bot/discord-cart";
import {
  completeDiscordGameNicknameSubmission,
  createNativeDiscordGameNicknameResponse,
  parseNativeDiscordGameNicknameInteraction,
} from "@/lib/bot/discord-game-nickname";
import {
  completeDiscordTicketClose,
  createNativeDiscordTicketCloseCancelResponse,
  createNativeDiscordTicketClosePrompt,
  parseNativeDiscordTicketCloseInteraction,
} from "@/lib/bot/discord-ticket-close";
import {
  completeDiscordTicketDelivery,
  createNativeDiscordTicketDeliveryResponse,
  parseNativeDiscordTicketDeliveryInteraction,
} from "@/lib/bot/discord-ticket-delivery";
import { synchronizePublishedDiscordStorefronts } from "@/lib/bot/discord-storefront-sync";
import {
  loadBotMessageCustomization,
  loadBotRuntimeSettings,
  type BotRuntimeSettings,
} from "@/lib/bot/message-customization-server";
import {
  completeDiscordGiveawayParticipation,
  parseNativeDiscordGiveawayParticipation,
} from "@/lib/giveaways/discord-participation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAXIMUM_DISCORD_INTERACTION_BYTES = 64 * 1024;
const MAXIMUM_DESTRUCTIVE_INTERACTION_AGE_MS = 5 * 60 * 1_000;
const MAXIMUM_INTERACTION_SETTINGS_LOAD_MS = 1_000;

export async function POST(request: Request) {
  try {
    const native = await readNativeDiscordInteraction(request);
    if (native) {
      const signature = request.headers.get("x-signature-ed25519");
      const timestamp = request.headers.get("x-signature-timestamp");
      const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
      const signatureValid =
        signature && timestamp && publicKey
          ? await verifyKey(native.body, signature, timestamp, publicKey)
          : false;
      if (!signatureValid) {
        return new Response("Invalid signature", { status: 401 });
      }

      if (
        (native.scope === "ticket_close" || native.scope === "ticket_delivery") &&
        !isFreshDestructiveInteractionTimestamp(timestamp)
      ) {
        return new Response("Stale interaction", { status: 401 });
      }

      if (native.scope === "ticket_close") {
        if (native.interaction.kind === "request") {
          const settings = await loadBotRuntimeSettingsQuickly();
          return Response.json(createNativeDiscordTicketClosePrompt(native.raw, settings));
        }
        if (native.interaction.kind === "cancel") {
          const settings = await loadBotRuntimeSettingsQuickly();
          return Response.json(
            createNativeDiscordTicketCloseCancelResponse(native.raw, settings),
          );
        }

        after(async () => {
          try {
            await completeDiscordTicketClose(
              native.raw,
              await loadBotRuntimeSettings(),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "erro desconhecido";
            console.error(`[discord-ticket-close] ${message}`);
          }
        });
        return Response.json(native.interaction.response);
      }

      if (native.scope === "ticket_delivery") {
        const settings = await loadBotRuntimeSettingsQuickly();
        const delivery = createNativeDiscordTicketDeliveryResponse(native.raw, settings);
        if (delivery.authorized) {
          after(async () => {
            try {
              await completeDiscordTicketDelivery(
                native.raw,
                await loadBotRuntimeSettings(),
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : "erro desconhecido";
              console.error(`[discord-ticket-delivery] ${message}`);
            }
          });
        }
        return Response.json(delivery.response);
      }

      if (native.scope === "game_nickname") {
        if (native.interaction.kind === "open") {
          return Response.json(
            await createNativeDiscordGameNicknameResponse(
              native.interaction.orderId,
              loadBotMessageCustomization(),
            ),
          );
        }

        after(async () => {
          try {
            await completeDiscordGameNicknameSubmission(
              native.raw,
              await loadBotMessageCustomization(),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "erro desconhecido";
            console.error(`[discord-game-nickname] ${message}`);
          }
        });
        return Response.json(native.interaction.response);
      }

      if (native.scope === "giveaway_participation") {
        after(async () => {
          try {
            await completeDiscordGiveawayParticipation(native.raw);
          } catch (error) {
            const message = error instanceof Error ? error.message : "erro desconhecido";
            console.error(`[discord-giveaway:participation] ${message}`);
          }
        });
        return Response.json(native.interaction.response);
      }

      if (native.scope === "cart") {
        if (native.interaction.kind === "review") {
          return Response.json(
            createNativeDiscordCartReviewResponse(
              native.interaction.selections,
              native.interaction.options,
              native.interaction.responseType,
            ),
          );
        }

        if (native.interaction.kind === "open") {
          return Response.json(
            createNativeDiscordCartResponse(native.interaction.selections),
          );
        }

        after(async () => {
          try {
            const stockChanged = await completeDiscordCartPurchase(
              native.raw,
              await loadBotMessageCustomization(),
            );
            if (stockChanged) {
              const storefronts = await synchronizePublishedDiscordStorefronts();
              if (storefronts.failed > 0) {
                console.error(
                  `[discord-cart] ${storefronts.failed} vitrine(s) não foram sincronizadas.`,
                );
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "erro desconhecido";
            console.error(`[discord-cart] ${message}`);
          }
        });
        return Response.json(native.interaction.response);
      }

      if (native.interaction.kind === "open") {
        const customization = loadBotMessageCustomization();
        return Response.json(
          await createNativeDiscordQuantityResponse(
            native.interaction.productId,
            undefined,
            customization,
          ),
        );
      } else {
        after(async () => {
          try {
            const customization = await loadBotMessageCustomization();
            const stockChanged = await completeDiscordQuantityPurchase(
              native.raw,
              customization,
            );
            if (stockChanged) {
              const storefronts = await synchronizePublishedDiscordStorefronts();
              if (storefronts.failed > 0) {
                console.error(
                  `[discord-quantity] ${storefronts.failed} vitrine(s) não foram sincronizadas.`,
                );
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "erro desconhecido";
            console.error(`[discord-quantity] ${message}`);
          }
        });
      }
      return Response.json(native.interaction.response);
    }

    return await getDiscordBot().webhooks.discord(request, {
      waitUntil: (task) => after(() => task),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-webhook] ${message}`);
    return Response.json({ error: "Discord bot indisponível." }, { status: 503 });
  }
}

async function loadBotRuntimeSettingsQuickly(): Promise<BotRuntimeSettings> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const failClosed = new Promise<BotRuntimeSettings>((resolve) => {
    timeout = setTimeout(() => {
      void loadBotRuntimeSettings(null).then(resolve);
    }, MAXIMUM_INTERACTION_SETTINGS_LOAD_MS);
  });

  try {
    return await Promise.race([loadBotRuntimeSettings(), failClosed]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readNativeDiscordInteraction(request: Request) {
  const body = new Uint8Array(await request.clone().arrayBuffer());
  if (body.byteLength > MAXIMUM_DISCORD_INTERACTION_BYTES) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  const ticketClose = parseNativeDiscordTicketCloseInteraction(raw);
  if (ticketClose) {
    return { body, raw, scope: "ticket_close" as const, interaction: ticketClose };
  }

  const ticketDelivery = parseNativeDiscordTicketDeliveryInteraction(raw);
  if (ticketDelivery) {
    return {
      body,
      raw,
      scope: "ticket_delivery" as const,
      interaction: ticketDelivery,
    };
  }

  const gameNickname = parseNativeDiscordGameNicknameInteraction(raw);
  if (gameNickname) {
    return { body, raw, scope: "game_nickname" as const, interaction: gameNickname };
  }

  const giveawayParticipation = parseNativeDiscordGiveawayParticipation(raw);
  if (giveawayParticipation) {
    return {
      body,
      raw,
      scope: "giveaway_participation" as const,
      interaction: giveawayParticipation,
    };
  }

  const cart = parseNativeDiscordCartInteraction(raw);
  if (cart) return { body, raw, scope: "cart" as const, interaction: cart };

  const quantity = parseNativeDiscordQuantityInteraction(raw);
  return quantity
    ? { body, raw, scope: "quantity" as const, interaction: quantity }
    : null;
}

export function isFreshDestructiveInteractionTimestamp(
  timestamp: string | null,
  now = Date.now(),
) {
  if (!timestamp || !/^[0-9]{10,13}$/.test(timestamp)) return false;
  const timestampMs = Number(timestamp) * 1_000;
  return (
    Number.isSafeInteger(timestampMs) &&
    Math.abs(now - timestampMs) <= MAXIMUM_DESTRUCTIVE_INTERACTION_AGE_MS
  );
}
