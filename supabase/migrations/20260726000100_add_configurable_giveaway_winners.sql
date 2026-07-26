-- Let administrators configure up to five winners. The reserved package is
-- divided between the actual winners, and each winner receives a private
-- delivery ticket for their share.

begin;

set local lock_timeout = '5s';

alter table public.giveaways
  add column if not exists winner_count smallint not null default 1;

alter table public.giveaways
  drop constraint if exists giveaways_winner_count_range;
alter table public.giveaways
  add constraint giveaways_winner_count_range
  check (winner_count between 1 and 5);

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

  update public.audit_events
  set metadata = metadata || jsonb_build_object('winner_count', p_winner_count)
  where entity_type = 'giveaway'
    and entity_id = v_created.created_giveaway_id
    and action = 'giveaway.create';

  return query
  select
    v_created.created_giveaway_id,
    v_created.created_status,
    v_created.created_public_slug;
end
$$;

create or replace function public.claim_due_giveaway_v3(p_claim_token uuid)
returns table (
  giveaway_id uuid,
  discord_guild_id text,
  required_valid_invites integer,
  minimum_stay_minutes integer,
  ends_at timestamptz,
  winner_count smallint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway_id uuid;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Claim token is required.';
  end if;

  select giveaway.id into v_giveaway_id
  from public.giveaways as giveaway
  where (
      giveaway.status in ('scheduled', 'active')
      and giveaway.ends_at <= statement_timestamp()
    ) or (
      giveaway.status = 'drawing'
      and giveaway.processing_claimed_at < statement_timestamp() - interval '5 minutes'
    )
  order by giveaway.ends_at, giveaway.id
  for update skip locked
  limit 1;
  if not found then return; end if;

  update public.giveaways
  set
    status = 'drawing',
    processing_claim_token = p_claim_token,
    processing_claimed_at = statement_timestamp()
  where id = v_giveaway_id;

  return query
  select
    giveaway.id,
    guild.discord_guild_id,
    giveaway.required_valid_invites,
    giveaway.minimum_stay_minutes,
    giveaway.ends_at,
    giveaway.winner_count
  from public.giveaways as giveaway
  join public.guilds as guild on guild.id = giveaway.guild_id
  where giveaway.id = v_giveaway_id;
end
$$;

create or replace function public.pick_giveaway_winners(
  p_giveaway_id uuid,
  p_claim_token uuid
)
returns table (
  winner_position smallint,
  entry_id uuid,
  discord_user_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
begin
  select * into v_giveaway
  from public.giveaways
  where id = p_giveaway_id
  for update;
  if not found
    or v_giveaway.status <> 'drawing'
    or v_giveaway.processing_claim_token is distinct from p_claim_token then
    raise exception using errcode = '42501', message = 'Giveaway draw claim was superseded.';
  end if;

  return query
  with candidates as (
    select
      entry.id,
      entry.discord_user_id,
      gen_random_uuid() as random_order
    from public.giveaway_entries as entry
    where entry.giveaway_id = v_giveaway.id
      and entry.membership_is_valid
      and entry.membership_checked_at >= v_giveaway.ends_at
      and (
        select count(*)
        from public.giveaway_referrals as referral
        where referral.referrer_entry_id = entry.id
          and referral.draw_is_valid
          and referral.draw_checked_at >= v_giveaway.ends_at
          and referral.join_completed_at is not null
      ) >= v_giveaway.required_valid_invites
  ),
  selected as (
    select candidate.*
    from candidates as candidate
    order by candidate.random_order
    limit v_giveaway.winner_count
  )
  select
    row_number() over (order by selected.random_order)::smallint,
    selected.id,
    selected.discord_user_id
  from selected
  order by selected.random_order;
end
$$;

create or replace function public.complete_giveaway_draw_v3(
  p_giveaway_id uuid,
  p_claim_token uuid,
  p_winner_entry_ids uuid[]
)
returns table (
  completed_giveaway_id uuid,
  resulting_status public.giveaway_status,
  actual_winner_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
  v_first_entry public.giveaway_entries%rowtype;
  v_requested_count integer := coalesce(cardinality(p_winner_entry_ids), 0);
  v_valid_count integer;
begin
  select * into v_giveaway
  from public.giveaways
  where id = p_giveaway_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Giveaway was not found.';
  end if;
  if v_giveaway.status <> 'drawing'
    or v_giveaway.processing_claim_token is distinct from p_claim_token then
    raise exception using errcode = '42501', message = 'Giveaway draw claim was superseded.';
  end if;

  if v_requested_count = 0 then
    perform 1
    from public.products as product
    join public.giveaway_prizes as prize on prize.product_id = product.id
    where prize.giveaway_id = v_giveaway.id
    order by product.id
    for update of product;

    update public.products as product
    set stock_quantity = product.stock_quantity + prize.quantity
    from public.giveaway_prizes as prize
    where prize.giveaway_id = v_giveaway.id
      and prize.product_id = product.id;

    update public.giveaways
    set
      status = 'failed',
      failure_reason = 'Nenhum participante elegível no encerramento.',
      stock_released_at = statement_timestamp(),
      processing_claim_token = null,
      processing_claimed_at = null
    where id = v_giveaway.id;

    return query
    select v_giveaway.id, 'failed'::public.giveaway_status, 0;
    return;
  end if;

  if v_requested_count > v_giveaway.winner_count or v_requested_count > 5 then
    raise exception using errcode = '22023', message = 'Winner count exceeds the configured limit.';
  end if;
  if (
    select count(distinct selected.entry_id)
    from unnest(p_winner_entry_ids) as selected(entry_id)
  ) <> v_requested_count then
    raise exception using errcode = '22023', message = 'Winner entries must be unique and non-null.';
  end if;

  perform 1
  from public.giveaway_entries as entry
  where entry.giveaway_id = v_giveaway.id
    and entry.id = any(p_winner_entry_ids)
  order by entry.id
  for update;

  select count(*)
  into v_valid_count
  from public.giveaway_entries as entry
  where entry.giveaway_id = v_giveaway.id
    and entry.id = any(p_winner_entry_ids)
    and entry.membership_is_valid
    and entry.membership_checked_at >= v_giveaway.ends_at
    and (
      select count(*)
      from public.giveaway_referrals as referral
      where referral.referrer_entry_id = entry.id
        and referral.draw_is_valid
        and referral.draw_checked_at >= v_giveaway.ends_at
        and referral.join_completed_at is not null
    ) >= v_giveaway.required_valid_invites;
  if v_valid_count <> v_requested_count then
    raise exception using errcode = '42501', message = 'One or more winners are no longer eligible.';
  end if;

  insert into public.giveaway_winners (
    giveaway_id,
    entry_id,
    winner_position,
    discord_user_id,
    display_name
  )
  select
    v_giveaway.id,
    entry.id,
    selected.ordinality::smallint,
    entry.discord_user_id,
    entry.display_name
  from unnest(p_winner_entry_ids) with ordinality as selected(entry_id, ordinality)
  join public.giveaway_entries as entry on entry.id = selected.entry_id
  order by selected.ordinality;

  select entry.* into strict v_first_entry
  from public.giveaway_entries as entry
  where entry.id = p_winner_entry_ids[1];

  update public.giveaways
  set
    status = 'completed',
    winner_entry_id = v_first_entry.id,
    winner_discord_user_id = v_first_entry.discord_user_id,
    winner_display_name = v_first_entry.display_name,
    drawn_at = statement_timestamp(),
    processing_claim_token = null,
    processing_claimed_at = null,
    discord_ticket_status = 'not_created',
    failure_reason = null
  where id = v_giveaway.id;

  return query
  select v_giveaway.id, 'completed'::public.giveaway_status, v_requested_count;
end
$$;

-- Rotate indivisible units between winner positions for each prize line. This
-- keeps the package as balanced as possible instead of always favoring the
-- first winner whenever several products have a remainder.
create or replace function public.claim_giveaway_winner_ticket(p_claim_token uuid)
returns table (
  winner_id uuid,
  giveaway_id uuid,
  discord_guild_id text,
  winner_discord_user_id text,
  winner_display_name text,
  ticket_category_id text,
  giveaway_title text,
  prizes jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_winner_id uuid;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Claim token is required.';
  end if;

  select winner.id into v_winner_id
  from public.giveaway_winners as winner
  join public.giveaways as giveaway on giveaway.id = winner.giveaway_id
  where giveaway.status = 'completed'
    and (
      winner.ticket_status in ('not_created', 'failed')
      or (
        winner.ticket_status = 'creating'
        and winner.ticket_claimed_at < statement_timestamp() - interval '5 minutes'
      )
    )
  order by giveaway.drawn_at, winner.winner_position, winner.id
  for update of winner skip locked
  limit 1;
  if not found then return; end if;

  update public.giveaway_winners
  set
    ticket_status = 'creating',
    ticket_claim_token = p_claim_token,
    ticket_claimed_at = statement_timestamp(),
    ticket_error = null
  where id = v_winner_id;

  update public.giveaways as giveaway
  set
    discord_ticket_status = 'creating',
    discord_ticket_claim_token = p_claim_token,
    discord_ticket_claimed_at = statement_timestamp()
  from public.giveaway_winners as winner
  where winner.id = v_winner_id
    and winner.giveaway_id = giveaway.id
    and winner.winner_position = 1;

  return query
  with winner_count as (
    select count(*)::integer as value
    from public.giveaway_winners as candidate
    join public.giveaway_winners as selected on selected.id = v_winner_id
    where candidate.giveaway_id = selected.giveaway_id
  ),
  prize_offsets as (
    select
      prize.*,
      coalesce(
        sum(prize.quantity) over (
          partition by prize.giveaway_id
          order by prize.position
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::integer as units_before
    from public.giveaway_prizes as prize
  ),
  allocation as (
    select
      winner.id as winner_id,
      winner.giveaway_id,
      winner.winner_position,
      prize.position,
      prize.product_name,
      (prize.quantity / winner_count.value)
      + case
          when (
            winner.winner_position - 1
            - (prize.units_before % winner_count.value)
            + winner_count.value
          ) % winner_count.value < (prize.quantity % winner_count.value)
          then 1
          else 0
        end as quantity
    from public.giveaway_winners as winner
    join prize_offsets as prize on prize.giveaway_id = winner.giveaway_id
    cross join winner_count
    where winner.id = v_winner_id
  )
  select
    winner.id,
    giveaway.id,
    guild.discord_guild_id,
    winner.discord_user_id,
    winner.display_name,
    giveaway.ticket_category_id,
    giveaway.title,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_name', allocation.product_name,
          'quantity', allocation.quantity
        ) order by allocation.position
      ) filter (where allocation.quantity > 0),
      '[]'::jsonb
    )
  from public.giveaway_winners as winner
  join public.giveaways as giveaway on giveaway.id = winner.giveaway_id
  join public.guilds as guild on guild.id = giveaway.guild_id
  join allocation on allocation.winner_id = winner.id
  where winner.id = v_winner_id
  group by winner.id, giveaway.id, guild.discord_guild_id;
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

revoke all on function public.claim_due_giveaway_v3(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_giveaway_v3(uuid) to service_role;

revoke all on function public.pick_giveaway_winners(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pick_giveaway_winners(uuid, uuid) to service_role;

revoke all on function public.complete_giveaway_draw_v3(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.complete_giveaway_draw_v3(uuid, uuid, uuid[])
  to service_role;

revoke all on function public.claim_giveaway_winner_ticket(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_giveaway_winner_ticket(uuid) to service_role;

comment on column public.giveaways.winner_count is
  'Configured maximum number of unique winners, between one and five.';
comment on function public.admin_create_giveaway_v3(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, integer, integer, integer, integer, jsonb
) is 'Creates an active giveaway for one to five winners and reserves its full prize package.';
comment on function public.pick_giveaway_winners(uuid, uuid) is
  'Randomly selects up to the configured number of unique eligible giveaway entries.';
comment on function public.complete_giveaway_draw_v3(uuid, uuid, uuid[]) is
  'Atomically records one to five unique winners for a claimed giveaway draw.';

commit;
