#!/usr/bin/env node
/**
 * Read-only health check for the GWStore roulette.
 *
 * Written to be run beside a real R$ 1,00 test: every step of the paid path
 * gets one line saying whether it has ever happened and whether the numbers add
 * up. It only reads — no insert, no update, no delete.
 *
 *   node apps/web/scripts/roulette-doctor.mjs
 *   node apps/web/scripts/roulette-doctor.mjs --watch
 *
 * The service key is pulled from the already-authenticated Supabase CLI, so
 * nothing has to live in a file on disk. It is never printed.
 */

import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const WATCH = process.argv.includes("--watch");
const POLL_MS = 5_000;

const brl = (cents) => `R$ ${((cents ?? 0) / 100).toFixed(2).replace(".", ",")}`;
const dim = (text) => `[2m${text}[0m`;
const green = (text) => `[32m${text}[0m`;
const yellow = (text) => `[33m${text}[0m`;
const red = (text) => `[31m${text}[0m`;

function line(state, label, detail) {
  const mark = { ok: green("✓"), waiting: yellow("·"), bad: red("✗") }[state];
  console.log(`${mark} ${label.padEnd(34)} ${detail}`);
}

async function connect() {
  const ref = (await readFile(resolve(repoRoot, "supabase/.temp/project-ref"), "utf8")).trim();
  const { stdout } = await run(
    "npx",
    ["--yes", "supabase", "projects", "api-keys", "--project-ref", ref, "-o", "json"],
    { cwd: repoRoot, maxBuffer: 1024 * 1024 },
  );
  const key = JSON.parse(stdout).find((entry) => entry.name === "service_role")?.api_key;
  if (!key) throw new Error("A CLI do Supabase não devolveu a chave service_role.");

  const { createClient } = require(resolve(repoRoot, "node_modules/@supabase/supabase-js"));
  return createClient(`https://${ref}.supabase.co`, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function rows(db, table, columns) {
  const { data, error } = await db.from(table).select(columns).limit(5_000);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

/** Espelha private.roulette_sale_credit: meio para cima, divisão inteira. */
function saleCredit(valueCents, saleRateBps) {
  return Math.trunc((Math.max(valueCents, 0) * Math.max(saleRateBps, 0) + 5000) / 10000);
}

async function report(db) {
  const { data: settings } = await db
    .from("platform_settings")
    .select("roulette_sale_rate_bps")
    .eq("id", 1)
    .maybeSingle();
  const saleRateBps = settings?.roulette_sale_rate_bps ?? 5000;

  const [purchases, entries, spins, inventory, redemptions, items, slots, staff, wallets] =
    await Promise.all([
      rows(db, "roulette_coin_purchases", "auth_user_id,amount_cents,status,created_at"),
      rows(db, "roulette_coin_entries", "auth_user_id,kind,amount_cents,prize_key,created_at"),
      rows(db, "roulette_demo_spins", "id,auth_user_id,prize_key,prize_value_cents,created_at"),
      rows(db, "roulette_demo_inventory", "auth_user_id,prize_key,product_id,unit_value_cents,quantity"),
      rows(db, "roulette_redemptions", "id,auth_user_id,status,discord_ticket_status,item_count"),
      rows(db, "roulette_redemption_items", "redemption_id,product_id,product_name,value_cents,quantity"),
      rows(db, "roulette_prize_products", "prize_key,products(id,name,minimum_price_cents,stock_quantity)"),
      rows(db, "admin_profiles", "auth_user_id"),
      rows(db, "roulette_coin_balances", "auth_user_id,balance_cents"),
    ]);

  // Giro de administrador é teste interno e não conta em lugar nenhum.
  const isStaff = new Set(staff.map((row) => row.auth_user_id));
  const player = (row) => !isStaff.has(row.auth_user_id);

  const credited = purchases.filter((p) => p.status === "credited" && player(p));
  const awaiting = purchases.filter((p) => p.status === "awaiting_payment" && player(p));
  const playerSpins = spins.filter(player);
  const sales = entries.filter((e) => e.kind === "sale" && player(e));
  const spinDebits = entries.filter((e) => e.kind === "spin" && player(e));
  const playerRedemptions = redemptions.filter(player);
  const held = inventory.filter(player);

  console.log(`\n${dim(new Date().toLocaleTimeString("pt-BR"))}  roleta — só contas de jogador\n`);

  line(
    credited.length ? "ok" : awaiting.length ? "waiting" : "waiting",
    "1. depósito creditado",
    credited.length
      ? `${credited.length} · ${brl(credited.reduce((s, p) => s + p.amount_cents, 0))}`
      : awaiting.length
        ? yellow(`${awaiting.length} aguardando pagamento — o webhook ainda não creditou`)
        : dim("nenhuma compra aberta ainda"),
  );

  line(
    spinDebits.length ? "ok" : "waiting",
    "2. giro pago",
    spinDebits.length
      ? `${spinDebits.length} giro(s) · ${brl(spinDebits.reduce((s, e) => s + Math.abs(e.amount_cents), 0))} em moedas`
      : dim("spin_roulette nunca rodou com jogador"),
  );

  // O arredondamento novo: 15c tem que creditar 8c, não 7c.
  const priceOf = new Map(
    slots.map((slot) => [slot.prize_key, slot.products?.minimum_price_cents ?? 0]),
  );
  const wrongRounding = sales.filter((sale) => {
    const value = priceOf.get(sale.prize_key);
    const perUnit = value ? saleCredit(value, saleRateBps) : 0;
    // O crédito é o valor por unidade vezes a quantidade, então tem que ser um
    // múltiplo exato dele. O arredondamento antigo dava 7 onde agora dá 8.
    return perUnit > 0 && sale.amount_cents % perUnit !== 0;
  });
  line(
    sales.length === 0 ? "waiting" : wrongRounding.length ? "bad" : "ok",
    "3. recompra arredondada",
    sales.length === 0
      ? dim("nenhuma venda de jogador ainda")
      : wrongRounding.length
        ? red(`${wrongRounding.length} venda(s) com crédito fora do esperado`)
        : `${sales.length} venda(s) · ${brl(sales.reduce((s, e) => s + e.amount_cents, 0))}`,
  );

  const withTicket = playerRedemptions.filter((r) => r.discord_ticket_status === "open");
  line(
    playerRedemptions.length === 0 ? "waiting" : withTicket.length ? "ok" : "bad",
    "4. resgate + ticket no Discord",
    playerRedemptions.length === 0
      ? dim("nenhum resgate de jogador ainda")
      : `${playerRedemptions.length} pedido(s), ${withTicket.length} com ticket aberto`,
  );

  const delivered = playerRedemptions.filter((r) => r.status === "delivered");
  const deliveredIds = new Set(delivered.map((r) => r.id));
  const deliveredLines = items.filter((l) => deliveredIds.has(l.redemption_id));
  line(
    delivered.length ? "ok" : "waiting",
    "5. entrega baixou o estoque",
    delivered.length
      ? `${deliveredLines.reduce((s, l) => s + l.quantity, 0)} unidade(s) entregue(s)`
      : dim("nenhuma entrega marcada ainda"),
  );

  // A identidade que o painel usa: todo prêmio sorteado está num dos três lugares.
  const redeemedUnits = items
    .filter((l) => {
      const parent = playerRedemptions.find((r) => r.id === l.redemption_id);
      return parent && parent.status !== "cancelled";
    })
    .reduce((s, l) => s + l.quantity, 0);
  const heldUnits = held.reduce((s, i) => s + i.quantity, 0);
  const soldUnits = playerSpins.length - redeemedUnits - heldUnits;
  const closes = soldUnits >= 0;
  line(
    playerSpins.length === 0 ? "waiting" : closes ? "ok" : "bad",
    "6. contas fechando",
    playerSpins.length === 0
      ? dim("sem giro de jogador, nada a conferir")
      : `${playerSpins.length} ganhos = ${soldUnits} vendidos + ${redeemedUnits} resgatados + ${heldUnits} guardados`,
  );

  const gross = credited.reduce((s, p) => s + p.amount_cents, 0);
  const liability = wallets.filter(player).reduce((s, w) => s + w.balance_cents, 0);
  console.log(
    `\n  ${dim("depositado")} ${brl(gross)}   ${dim("moedas em carteira")} ${brl(liability)}   ` +
      `${dim("prêmios sorteados")} ${brl(playerSpins.reduce((s, spin) => s + spin.prize_value_cents, 0))}`,
  );

  // Estoque das fatias, que é o que decide se um resgate consegue abrir.
  const stock = slots
    .filter((slot) => slot.products)
    .map((slot) => `${brl(slot.products.minimum_price_cents)}: ${slot.products.stock_quantity}un`)
    .join("   ");
  if (stock) console.log(`  ${dim("estoque")} ${stock}`);

  const unfrozen = inventory.filter((i) => !i.product_id || i.unit_value_cents <= 0);
  if (unfrozen.length) {
    console.log(`\n  ${red(`${unfrozen.length} unidade(s) sem produto ou preço congelado`)}`);
  }
}

const db = await connect();
await report(db);

if (WATCH) {
  console.log(dim("\n  acompanhando — Ctrl+C para sair"));
  setInterval(() => {
    report(db).catch((error) => console.error(red(`  ${error.message}`)));
  }, POLL_MS);
}
