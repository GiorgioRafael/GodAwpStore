-- Record each giveaway winner independently so announcements and delivery
-- tickets remain idempotent when a giveaway has more than one winner.

begin;

set local lock_timeout = '5s';

create table if not exists public.giveaway_winners (
  id uuid primary key default gen_random_uuid(),
  giveaway_id uuid not null references public.giveaways (id) on delete cascade,
  entry_id uuid not null references public.giveaway_entries (id) on delete restrict,
  winner_position smallint not null,
  discord_user_id text not null,
  display_name text not null,
  ticket_status public.discord_ticket_status not null default 'not_created',
  ticket_channel_id text,
  ticket_claim_token uuid,
  ticket_claimed_at timestamptz,
  ticket_error text,
  created_at timestamptz not null default now(),
  constraint giveaway_winners_entry_unique unique (giveaway_id, entry_id),
  constraint giveaway_winners_position_unique unique (giveaway_id, winner_position),
  constraint giveaway_winners_position_positive check (winner_position > 0),
  constraint giveaway_winners_user_format check (discord_user_id ~ '^[0-9]{15,22}$'),
  constraint giveaway_winners_ticket_channel_format check (
    ticket_channel_id is null or ticket_channel_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaway_winners_ticket_state check (
    (
      ticket_status = 'open'
      and ticket_channel_id is not null
      and ticket_claim_token is null
      and ticket_claimed_at is null
    )
    or (
      ticket_status = 'creating'
      and ticket_channel_id is null
      and ticket_claim_token is not null
      and ticket_claimed_at is not null
    )
    or (
      ticket_status in ('not_created', 'failed')
      and ticket_channel_id is null
      and ticket_claim_token is null
      and ticket_claimed_at is null
    )
  )
);

create index if not exists giveaway_winners_ticket_claim_idx
  on public.giveaway_winners (ticket_status, created_at, id)
  where ticket_status in ('not_created', 'failed', 'creating');

alter table public.giveaway_winners enable row level security;
alter table public.giveaway_winners force row level security;

revoke all on table public.giveaway_winners from public, anon, authenticated;
grant select, insert, update on table public.giveaway_winners to service_role;

-- Preserve already completed single-winner giveaways.
insert into public.giveaway_winners (
  giveaway_id,
  entry_id,
  winner_position,
  discord_user_id,
  display_name,
  ticket_status,
  ticket_channel_id,
  ticket_claim_token,
  ticket_claimed_at,
  ticket_error,
  created_at
)
select
  giveaway.id,
  giveaway.winner_entry_id,
  1,
  giveaway.winner_discord_user_id,
  giveaway.winner_display_name,
  giveaway.discord_ticket_status,
  giveaway.discord_ticket_channel_id,
  giveaway.discord_ticket_claim_token,
  giveaway.discord_ticket_claimed_at,
  case when giveaway.discord_ticket_status = 'failed' then giveaway.failure_reason end,
  coalesce(giveaway.drawn_at, giveaway.updated_at)
from public.giveaways as giveaway
where giveaway.status = 'completed'
  and giveaway.winner_entry_id is not null
  and giveaway.winner_discord_user_id is not null
  and giveaway.winner_display_name is not null
on conflict (giveaway_id, entry_id) do nothing;

-- A ticket may have been opened by the legacy worker between winner creation
-- and this migration. Mirror that state before the new worker starts.
update public.giveaway_winners as winner
set
  ticket_status = giveaway.discord_ticket_status,
  ticket_channel_id = giveaway.discord_ticket_channel_id,
  ticket_claim_token = giveaway.discord_ticket_claim_token,
  ticket_claimed_at = giveaway.discord_ticket_claimed_at,
  ticket_error = case
    when giveaway.discord_ticket_status = 'failed' then giveaway.failure_reason
    else null
  end
from public.giveaways as giveaway
where winner.giveaway_id = giveaway.id
  and winner.winner_position = 1
  and winner.ticket_status = 'not_created'
  and giveaway.discord_ticket_status <> 'not_created';

create or replace function public.complete_giveaway_draw_v2(
  p_giveaway_id uuid,
  p_claim_token uuid,
  p_winner_entry_id uuid
)
returns table (
  completed_giveaway_id uuid,
  resulting_status public.giveaway_status,
  winner_discord_user_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
  v_entry public.giveaway_entries%rowtype;
  v_valid_invite_count integer;
begin
  select * into v_giveaway
  from public.giveaways where id = p_giveaway_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Giveaway was not found.';
  end if;
  if v_giveaway.status <> 'drawing'
    or v_giveaway.processing_claim_token is distinct from p_claim_token then
    raise exception using errcode = '42501', message = 'Giveaway draw claim was superseded.';
  end if;

  if p_winner_entry_id is null then
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
    return query select v_giveaway.id, 'failed'::public.giveaway_status, null::text;
    return;
  end if;

  select * into v_entry
  from public.giveaway_entries
  where id = p_winner_entry_id
    and giveaway_id = v_giveaway.id
    and membership_is_valid
    and membership_checked_at >= v_giveaway.ends_at
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Winner is no longer a valid member.';
  end if;

  select count(*)::integer
  into v_valid_invite_count
  from public.giveaway_referrals as referral
  where referral.referrer_entry_id = v_entry.id
    and referral.draw_is_valid
    and referral.draw_checked_at >= v_giveaway.ends_at
    and referral.join_completed_at is not null;
  if v_valid_invite_count < v_giveaway.required_valid_invites then
    raise exception using errcode = '42501', message = 'Winner no longer has enough valid referrals.';
  end if;

  insert into public.giveaway_winners (
    giveaway_id,
    entry_id,
    winner_position,
    discord_user_id,
    display_name
  )
  values (
    v_giveaway.id,
    v_entry.id,
    1,
    v_entry.discord_user_id,
    v_entry.display_name
  )
  on conflict (giveaway_id, entry_id) do nothing;

  update public.giveaways
  set
    status = 'completed',
    winner_entry_id = v_entry.id,
    winner_discord_user_id = v_entry.discord_user_id,
    winner_display_name = v_entry.display_name,
    drawn_at = statement_timestamp(),
    processing_claim_token = null,
    processing_claimed_at = null,
    discord_ticket_status = 'not_created',
    failure_reason = null
  where id = v_giveaway.id;

  return query select v_giveaway.id, 'completed'::public.giveaway_status, v_entry.discord_user_id;
end
$$;

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
          'product_name', prize.product_name,
          'quantity',
            (prize.quantity / winner_count.value)
            + case
                when winner.winner_position <= (prize.quantity % winner_count.value) then 1
                else 0
              end
        ) order by prize.position
      ) filter (
        where
          (prize.quantity / winner_count.value)
          + case
              when winner.winner_position <= (prize.quantity % winner_count.value) then 1
              else 0
            end > 0
      ),
      '[]'::jsonb
    )
  from public.giveaway_winners as winner
  join public.giveaways as giveaway on giveaway.id = winner.giveaway_id
  join public.guilds as guild on guild.id = giveaway.guild_id
  join public.giveaway_prizes as prize on prize.giveaway_id = giveaway.id
  cross join winner_count
  where winner.id = v_winner_id
  group by winner.id, giveaway.id, guild.discord_guild_id, winner_count.value;
end
$$;

create or replace function public.complete_giveaway_winner_ticket(
  p_winner_id uuid,
  p_claim_token uuid,
  p_channel_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway_id uuid;
  v_position smallint;
begin
  if p_channel_id is null or p_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord ticket channel is invalid.';
  end if;

  update public.giveaway_winners
  set
    ticket_status = 'open',
    ticket_channel_id = p_channel_id,
    ticket_claim_token = null,
    ticket_claimed_at = null,
    ticket_error = null
  where id = p_winner_id
    and ticket_status = 'creating'
    and ticket_claim_token = p_claim_token
  returning giveaway_id, winner_position into v_giveaway_id, v_position;
  if not found then return false; end if;

  if v_position = 1 then
    update public.giveaways
    set
      discord_ticket_status = 'open',
      discord_ticket_channel_id = p_channel_id,
      discord_ticket_claim_token = null,
      discord_ticket_claimed_at = null,
      failure_reason = null
    where id = v_giveaway_id;
  end if;
  return true;
end
$$;

create or replace function public.fail_giveaway_winner_ticket(
  p_winner_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway_id uuid;
  v_position smallint;
begin
  update public.giveaway_winners
  set
    ticket_status = 'failed',
    ticket_channel_id = null,
    ticket_claim_token = null,
    ticket_claimed_at = null,
    ticket_error = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
  where id = p_winner_id
    and ticket_status = 'creating'
    and ticket_claim_token = p_claim_token
  returning giveaway_id, winner_position into v_giveaway_id, v_position;
  if not found then return false; end if;

  if v_position = 1 then
    update public.giveaways
    set
      discord_ticket_status = 'failed',
      discord_ticket_channel_id = null,
      discord_ticket_claim_token = null,
      discord_ticket_claimed_at = null,
      failure_reason = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
    where id = v_giveaway_id;
  end if;
  return true;
end
$$;

revoke all on function public.claim_giveaway_winner_ticket(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_giveaway_winner_ticket(uuid) to service_role;

revoke all on function public.complete_giveaway_winner_ticket(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_giveaway_winner_ticket(uuid, uuid, text)
  to service_role;

revoke all on function public.fail_giveaway_winner_ticket(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_giveaway_winner_ticket(uuid, uuid, text)
  to service_role;

commit;
