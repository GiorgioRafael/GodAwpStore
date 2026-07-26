-- Legacy ticket workers update giveaways directly. Reconcile their completed
-- or in-flight ticket state before the multi-winner worker claims more work,
-- preventing duplicate delivery tickets for historical winners.

begin;

set local lock_timeout = '5s';

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
    and winner.ticket_status in ('not_created', 'failed')
    and giveaway.discord_ticket_status in ('open', 'creating');

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

revoke all on function public.claim_giveaway_winner_ticket(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_giveaway_winner_ticket(uuid) to service_role;

comment on function public.claim_giveaway_winner_ticket(uuid) is
  'Claims one winner ticket after reconciling tickets already handled by the legacy worker.';

commit;
