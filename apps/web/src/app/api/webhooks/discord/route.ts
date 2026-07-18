import { after } from "next/server";
import { verifyKey } from "discord-interactions";

import {
  completeDiscordQuantityPurchase,
  createNativeDiscordQuantityResponse,
  getDiscordBot,
  parseNativeDiscordQuantityInteraction,
} from "@/lib/bot/discord-bot";
import {
  completeDiscordGameNicknameSubmission,
  createNativeDiscordGameNicknameResponse,
  parseNativeDiscordGameNicknameInteraction,
} from "@/lib/bot/discord-game-nickname";
import { synchronizePublishedDiscordStorefronts } from "@/lib/bot/discord-storefront-sync";
import { loadBotMessageCustomization } from "@/lib/bot/message-customization-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAXIMUM_DISCORD_INTERACTION_BYTES = 64 * 1024;

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

async function readNativeDiscordInteraction(request: Request) {
  const body = new Uint8Array(await request.clone().arrayBuffer());
  if (body.byteLength > MAXIMUM_DISCORD_INTERACTION_BYTES) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  const gameNickname = parseNativeDiscordGameNicknameInteraction(raw);
  if (gameNickname) {
    return { body, raw, scope: "game_nickname" as const, interaction: gameNickname };
  }

  const quantity = parseNativeDiscordQuantityInteraction(raw);
  return quantity
    ? { body, raw, scope: "quantity" as const, interaction: quantity }
    : null;
}
