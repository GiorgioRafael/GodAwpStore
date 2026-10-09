-- GWStore-only operation. Never put this in the shared migration pipeline.
-- Before running, verify the connected Supabase project is athucowvfccegkzgcnli
-- and set this acknowledgement in the SAME session:
--   set app.gwstore_confirmed_project_ref = 'athucowvfccegkzgcnli';
-- Guild/catalog checks below fail if this is THStore or a shared database.
-- Existing balances, paid checkouts, inventories, redemptions and delivery
-- permissions are preserved. No tables, records or historical migrations change.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog;

do $disable_gw_roulette$
declare
  v_function record;
begin
  if current_setting('app.gwstore_confirmed_project_ref', true) is distinct from 'athucowvfccegkzgcnli' then
    raise exception 'Confirm the GWStore Supabase project in this session before proceeding.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gwstore:disable-roulette', 0));

  if not exists (
    select 1 from public.guilds where discord_guild_id = '1401264061101899820'
  ) or exists (
    select 1 from public.guilds where discord_guild_id is distinct from '1401264061101899820'
  ) then
    raise exception 'GWStore guild scope is not isolated; refusing to disable roulette.';
  end if;

  if not exists (
    select 1 from public.games
    where id = '4ae2512f-a698-4f2c-976e-3719ff6b0299' and slug = 'blox-fruits'
  ) or not exists (
    select 1 from public.catalog_stores
    where id = 'f629ea16-c538-455c-a671-02f4a52edec1'
      and game_id = '4ae2512f-a698-4f2c-976e-3719ff6b0299' and name = 'Frutas Permanentes'
  ) or not exists (
    select 1 from public.catalog_stores
    where id = '0b0e91fe-d7ba-5257-845d-7e78a9187d4a'
      and game_id = '4ae2512f-a698-4f2c-976e-3719ff6b0299'
  ) or not exists (
    select 1 from public.platform_settings where id = 1
  ) then
    raise exception 'Known GWStore catalog/settings do not match; refusing to disable roulette.';
  end if;

  if to_regprocedure('public.start_roulette_coin_purchase(text,integer)') is null
    or to_regprocedure('public.spin_roulette(text,text)') is null
    or to_regprocedure('public.sell_roulette_prizes(jsonb)') is null then
    raise exception 'Roulette schema changed; review the new-operation signatures before proceeding.';
  end if;

  update public.platform_settings set roulette_enabled = false where id = 1;

  -- Also cover superseded signatures if a legacy function survived an old
  -- deployment. This allowlist deliberately excludes settlement/delivery RPCs.
  for v_function in
    select p.oid, p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname = any (array[
      'start_roulette_coin_purchase', 'start_roulette_spin_charge',
      'spin_roulette', 'spin_paid_roulette', 'spin_demo_roulette',
      'sell_roulette_prizes', 'sell_roulette_prize'
    ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_function.signature);
    if has_function_privilege('anon', v_function.oid, 'EXECUTE')
      or has_function_privilege('authenticated', v_function.oid, 'EXECUTE') then
      raise exception 'A new roulette operation still has browser execution privileges: %', v_function.signature;
    end if;
  end loop;
end
$disable_gw_roulette$;

commit;
