-- Every newly configured giveaway starts at the database creation timestamp.
-- Keep the original scheduling RPC for rolling compatibility and recovery tests.

create or replace function public.admin_create_giveaway_v2(
  p_public_slug text,
  p_guild_id uuid,
  p_publication_channel_id text,
  p_publication_channel_name text,
  p_ticket_category_id text,
  p_ticket_category_name text,
  p_title text,
  p_description text,
  p_rules_text text,
  p_ends_at timestamptz,
  p_required_valid_invites integer,
  p_minimum_account_age_days integer,
  p_minimum_stay_minutes integer,
  p_prizes jsonb
)
returns table (
  created_giveaway_id uuid,
  created_status public.giveaway_status,
  created_public_slug text
)
language sql
security invoker
set search_path = pg_catalog
as $$
  select *
  from public.admin_create_giveaway(
    p_public_slug => p_public_slug,
    p_guild_id => p_guild_id,
    p_publication_channel_id => p_publication_channel_id,
    p_publication_channel_name => p_publication_channel_name,
    p_ticket_category_id => p_ticket_category_id,
    p_ticket_category_name => p_ticket_category_name,
    p_title => p_title,
    p_description => p_description,
    p_rules_text => p_rules_text,
    p_starts_at => statement_timestamp(),
    p_ends_at => p_ends_at,
    p_required_valid_invites => p_required_valid_invites,
    p_minimum_account_age_days => p_minimum_account_age_days,
    p_minimum_stay_minutes => p_minimum_stay_minutes,
    p_prizes => p_prizes
  );
$$;

revoke all on function public.admin_create_giveaway_v2(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, integer, integer, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_giveaway_v2(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, integer, integer, integer, jsonb
) to authenticated;

comment on function public.admin_create_giveaway_v2(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, integer, integer, integer, jsonb
) is 'Creates an active giveaway whose starts_at is fixed to the database creation time.';
