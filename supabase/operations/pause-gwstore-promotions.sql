-- Reversible pause for the isolated GWStore database, never the shared migration pipeline.
-- Confirm project athucowvfccegkzgcnli, then acknowledge in this same session:
-- set app.gwstore_confirmed_project_ref = 'athucowvfccegkzgcnli';
-- Re-enable the two settings to resume new offers. Historical offers stay auditable.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog;
do $pause_gw_promotions$
begin
  if current_setting('app.gwstore_confirmed_project_ref', true) is distinct from 'athucowvfccegkzgcnli'
    or not exists (select 1 from public.guilds where discord_guild_id = '1401264061101899820')
    or exists (select 1 from public.guilds where discord_guild_id is distinct from '1401264061101899820')
    or not exists (select 1 from public.games where id = '4ae2512f-a698-4f2c-976e-3719ff6b0299' and slug = 'blox-fruits')
    or not exists (select 1 from public.platform_settings where id = 1) then
    raise exception 'Confirm the isolated GWStore project before pausing promotions.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gwstore:pause-promotions', 0));
  update public.platform_settings set upsell_enabled = false, lead_recovery_enabled = false where id = 1;
  update public.upsell_offers set status = 'invalidated', resolved_at = now()
    where status = 'offered' and guild_id in (
      select id from public.guilds where discord_guild_id = '1401264061101899820');
  update public.lead_recovery_offers set status = 'invalidated', resolved_at = now(),
    delivery_claim_token = null, delivery_claimed_at = null
    where status in ('pending','sending','sent') and guild_id in (
      select id from public.guilds where discord_guild_id = '1401264061101899820');
end
$pause_gw_promotions$;
commit;
