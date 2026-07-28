-- The roulette delivery button gated on one list and settled on another.
--
-- createNativeRouletteDeliveryResponse authorizes the press against
-- platform_settings.ticket_close_admin_discord_user_ids — the same list the
-- paid-order delivery button uses — but
-- complete_roulette_redemption_discord_delivery resolved the actor from
-- public.admin_profiles. Ticket staff who close tickets but have never signed
-- into the web panel have no admin_profiles row, so the button accepted their
-- click, deferred, and then answered "indisponível" forever.
--
-- The RPC now accepts either, and records the profile only when there is one:
-- delivered_by stays honest instead of being forced to point at somebody else.

begin;

set local lock_timeout = '5s';

alter table public.roulette_redemptions
  add column if not exists delivered_by_discord_user_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'roulette_redemptions_delivered_by_discord_format'
      and conrelid = 'public.roulette_redemptions'::regclass
  ) then
    alter table public.roulette_redemptions
      add constraint roulette_redemptions_delivered_by_discord_format
      check (
        delivered_by_discord_user_id is null
        or delivered_by_discord_user_id ~ '^[0-9]{15,22}$'
      );
  end if;
end
$$;

comment on column public.roulette_redemptions.delivered_by_discord_user_id is
  'Who pressed the delivery button in Discord. Ticket staff need no web login, so this can be set while delivered_by stays null.';

create or replace function public.complete_roulette_redemption_discord_delivery(
  p_redemption_id uuid,
  p_admin_discord_id text,
  p_channel_id text
)
returns table (
  settled_redemption_id uuid,
  settled_status text,
  player_discord_id text,
  item_summary text,
  delivered_nickname text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_admin_auth_user_id uuid;
  v_authorized boolean := false;
  v_redemption public.roulette_redemptions%rowtype;
  v_summary text;
  v_settled record;
begin
  if p_redemption_id is null or p_admin_discord_id is null or p_channel_id is null then
    raise exception using
      errcode = '22023',
      message = 'The redemption, the administrator and the channel are all required.';
  end if;

  -- Either credential works: a web administrator, or somebody on the ticket
  -- closing list that gates the button in the first place.
  select profile.auth_user_id
  into v_admin_auth_user_id
  from public.admin_profiles as profile
  where profile.discord_user_id = p_admin_discord_id
    and profile.is_active;
  v_authorized := v_admin_auth_user_id is not null;

  if not v_authorized then
    select p_admin_discord_id = any (settings.ticket_close_admin_discord_user_ids)
    into v_authorized
    from public.platform_settings as settings
    where settings.id = 1;
  end if;

  if not coalesce(v_authorized, false) then
    raise exception using
      errcode = '42501',
      message = 'Administrator authorization is required.';
  end if;

  select redemption.*
  into v_redemption
  from public.roulette_redemptions as redemption
  where redemption.id = p_redemption_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Roulette redemption was not found.';
  end if;

  -- A button can only settle the ticket it lives in.
  if v_redemption.discord_ticket_channel_id is distinct from p_channel_id then
    raise exception using
      errcode = 'P0017',
      message = 'The button does not belong to this redemption ticket.';
  end if;

  -- 'cancelled' and 'delivered' both mean "not pending", but they need
  -- different answers: one was undone, the other was already done.
  if v_redemption.status = 'cancelled' then
    raise exception using
      errcode = 'P0019',
      message = 'This redemption was cancelled and cannot be delivered.';
  end if;

  select string_agg(
    format('%sx %s', line.quantity, line.product_name),
    E'\n'
    order by line.product_name
  )
  into v_summary
  from public.roulette_redemption_items as line
  where line.redemption_id = v_redemption.id;

  select * into v_settled
  from private.settle_roulette_redemption(p_redemption_id, 'delivered', v_admin_auth_user_id);

  update public.roulette_redemptions as redemption
  set delivered_by_discord_user_id = p_admin_discord_id
  where redemption.id = p_redemption_id;

  return query
  select
    v_settled.settled_redemption_id,
    v_settled.settled_status,
    v_redemption.discord_user_id,
    coalesce(v_summary, 'Prêmio da roleta'),
    v_redemption.game_nickname;
end;
$$;

revoke all on function public.complete_roulette_redemption_discord_delivery(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_roulette_redemption_discord_delivery(uuid, text, text)
  to service_role;

commit;
