-- Preserve the append-only audit log when configuring multiple winners.
-- admin_create_giveaway_v2 already records giveaway.create, so v3 only needs
-- to persist the winner count on the giveaway itself.

begin;

set local lock_timeout = '5s';

create or replace function public.admin_create_giveaway_v3(
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
  p_winner_count integer,
  p_prizes jsonb
)
returns table (
  created_giveaway_id uuid,
  created_status public.giveaway_status,
  created_public_slug text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_created record;
  v_total_prize_units bigint;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;
  if p_winner_count is null or p_winner_count not between 1 and 5 then
    raise exception using errcode = '22023', message = 'Selecione de 1 a 5 ganhadores.';
  end if;

  select *
  into strict v_created
  from public.admin_create_giveaway_v2(
    p_public_slug => p_public_slug,
    p_guild_id => p_guild_id,
    p_publication_channel_id => p_publication_channel_id,
    p_publication_channel_name => p_publication_channel_name,
    p_ticket_category_id => p_ticket_category_id,
    p_ticket_category_name => p_ticket_category_name,
    p_title => p_title,
    p_description => p_description,
    p_rules_text => p_rules_text,
    p_ends_at => p_ends_at,
    p_required_valid_invites => p_required_valid_invites,
    p_minimum_account_age_days => p_minimum_account_age_days,
    p_minimum_stay_minutes => p_minimum_stay_minutes,
    p_prizes => p_prizes
  );

  select sum(prize.quantity)
  into v_total_prize_units
  from public.giveaway_prizes as prize
  where prize.giveaway_id = v_created.created_giveaway_id;

  if coalesce(v_total_prize_units, 0) < p_winner_count then
    raise exception using
      errcode = '22023',
      message = 'O pacote precisa ter ao menos uma unidade de prêmio por ganhador.';
  end if;

  update public.giveaways
  set winner_count = p_winner_count
  where id = v_created.created_giveaway_id;

  return query
  select
    v_created.created_giveaway_id,
    v_created.created_status,
    v_created.created_public_slug;
end
$$;

revoke all on function public.admin_create_giveaway_v3(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, integer, integer, integer, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_giveaway_v3(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, integer, integer, integer, integer, jsonb
) to authenticated;

comment on function public.admin_create_giveaway_v3(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, integer, integer, integer, integer, jsonb
) is 'Creates an active giveaway for one to five winners without mutating its append-only audit event.';

commit;
