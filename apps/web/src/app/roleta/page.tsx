import type { Metadata } from "next";
import { MessageCircleMore, ShieldCheck, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";

import { RouletteExperience } from "@/components/roulette/roulette-experience";
import { RouletteHeader } from "@/components/roulette/roulette-header";
import { LinkButton } from "@/components/ui/button";
import { getAdminSession } from "@/lib/auth";
import { extractDiscordIdentity } from "@/lib/auth-identity";
import { STORE_NAME, STORE_SLUG } from "@/lib/brand";
import {
  buildRouletteWheelPrizes,
  normalizeDemoRouletteInventory,
  normalizeRoulettePrizeProducts,
} from "@/lib/roulette/demo";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Roleta",
  description: `Gire a roleta da ${STORE_NAME} por R$ 1,00.`,
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function RoulettePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (STORE_SLUG !== "gwstore") notFound();

  const [query, supabase] = await Promise.all([
    searchParams,
    createServerSupabaseClient(),
  ]);
  const { data: authData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  const identity = authData.user ? extractDiscordIdentity(authData.user) : null;

  if (!identity) {
    return (
      <>
        <RouletteHeader />
        <main className="relative grid min-h-[calc(100vh-76px)] place-items-center overflow-hidden bg-[#050306] px-4 py-12 text-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(217,70,239,.15),transparent_34%),radial-gradient(circle_at_10%_90%,rgba(126,34,206,.08),transparent_28%)]"
          />
          <section className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-fuchsia-300/20 bg-[#0e0913]/95 p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,.5)] sm:p-10">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-300 shadow-[0_0_28px_rgba(217,70,239,.14)]">
              <Sparkles aria-hidden="true" className="size-6" />
            </span>
            <h1 className="mt-6 text-3xl font-semibold tracking-[-0.045em]">
              Entre para girar a roleta
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#aa94b3]">
              Identifique sua conta pelo Discord para salvar cada prêmio no seu inventário.
            </p>
            {/* Uma tentativa que falhou volta para cá, não para o login do
                painel: lá a resposta é "apenas IDs autorizados", que um jogador
                lê como recusa em vez de "tente de novo". */}
            {query.erro === "login" ? (
              <p
                role="alert"
                className="mx-auto mt-5 max-w-md rounded-2xl border border-amber-300/25 bg-amber-400/[0.07] px-4 py-3 text-xs leading-5 text-amber-200"
              >
                O Discord não concluiu a entrada dessa vez. Tente novamente — a roleta é aberta a
                qualquer conta, não precisa de autorização.
              </p>
            ) : null}
            <LinkButton
              href="/auth/login?next=/roleta"
              size="lg"
              className="mt-7 w-full border-fuchsia-300/55 bg-fuchsia-500 text-white shadow-[0_15px_40px_rgba(217,70,239,.22)] hover:border-fuchsia-200 hover:bg-fuchsia-400"
            >
              <MessageCircleMore aria-hidden="true" className="size-5" />
              Continuar com Discord
            </LinkButton>
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-fuchsia-300/10 bg-black/20 p-4 text-left">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-emerald-400"
              />
              <p className="text-xs leading-5 text-[#8f7b98]">
                Cada moeda custa R$ 1,00 no Pix e vale um giro. Os prêmios ficam no seu
                inventário e podem ser vendidos de volta por moedas.
              </p>
            </div>
          </section>
        </main>
      </>
    );
  }

  const [inventoryResult, prizeResult, balanceResult, adminSession] = await Promise.all([
    supabase!.rpc("get_demo_roulette_inventory"),
    supabase!.rpc("get_roulette_prizes"),
    supabase!.rpc("get_roulette_coin_balance"),
    getAdminSession().catch(() => null),
  ]);
  const inventory = normalizeDemoRouletteInventory(inventoryResult.data ?? []);
  const prizes = buildRouletteWheelPrizes(
    normalizeRoulettePrizeProducts(prizeResult.data ?? []),
  );
  const balanceCents =
    typeof balanceResult.data === "number" && balanceResult.data >= 0 ? balanceResult.data : 0;
  const pendingPurchaseId = await readPendingPurchase(supabase!, readPurchaseId(query.compra));

  return (
    <>
      <RouletteHeader
        user={{
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
        }}
      />
      <RouletteExperience
        prizes={prizes}
        initialInventory={inventory}
        initialBalanceCents={balanceCents}
        available={!inventoryResult.error}
        isAdmin={adminSession?.status === "authorized"}
        initialPurchaseId={pendingPurchaseId}
      />
    </>
  );
}

function readPurchaseId(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
}

/**
 * The LivePix return lands on `/roleta?compra=…`. Only a purchase still waiting
 * for payment keeps the browser polling; a stale link is ignored so the player
 * is not greeted by an error.
 */
async function readPendingPurchase(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  purchaseId: string | null,
) {
  if (!purchaseId) return null;
  const { data } = await supabase.rpc("get_roulette_coin_purchase", {
    p_purchase_id: purchaseId,
  });
  const purchase = data?.[0];
  return purchase?.purchase_status === "awaiting_payment" ? purchase.purchase_id : null;
}
