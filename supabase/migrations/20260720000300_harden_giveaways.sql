-- Harden giveaway reconciliation, OAuth referral claims, publication recovery,
-- participant privacy, and full-set winner selection.

begin;

set local lock_timeout = '5s';

alter table public.giveaway_entries
  add column if not exists access_token uuid not null default gen_random_uuid(),
  add column if not exists membership_checked_at timestamptz,
  add column if not exists membership_is_valid boolean not null default false,
  add column if not exists membership_invalid_reason text;

create unique index if not exists giveaway_entries_access_token_idx
  on public.giveaway_entries (access_token);

create index if not exists giveaway_entries_draw_reconciliation_idx
  on public.giveaway_entries (giveaway_id, membership_checked_at, id);

alter table public.giveaway_referrals
  add column if not exists join_completed_at timestamptz,
  add column if not exists draw_checked_at timestamptz,
  add column if not exists draw_is_valid boolean not null default false,
  add column if not exists draw_invalid_reason text;

-- Rows created before the durable join flow only existed after Discord accepted
-- the member, so they are already completed claims.
update public.giveaway_referrals
set join_completed_at = coalesce(validated_at, last_checked_at, created_at)
where join_completed_at is null;

update public.giveaway_entries as entry
set valid_invite_count = (
  select count(*)::integer
  from public.giveaway_referrals as referral
  where referral.referrer_entry_id = entry.id
    and referral.status = 'valid'
    and referral.join_completed_at is not null
);

create index if not exists giveaway_referrals_draw_reconciliation_idx
  on public.giveaway_referrals (giveaway_id, draw_checked_at, id)
  where status in ('pending', 'valid');

-- Server-only readers use the service role. RLS remains forced for authenticated
-- users, and mutations continue to be exposed only through SECURITY DEFINER RPCs.
grant select on table public.giveaways to service_role;
grant select on table public.giveaway_prizes to service_role;
grant select on table public.giveaway_entries to service_role;
grant select on table public.giveaway_referrals to service_role;

create or replace function public.set_giveaway_referral_status(
  p_referral_id uuid,
  p_status public.giveaway_referral_status,
  p_invalid_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_referrer_entry_id uuid;
  v_referral public.giveaway_referrals%rowtype;
begin
  select referral.referrer_entry_id
  into v_referrer_entry_id
  from public.giveaway_referrals as referral
  where referral.id = p_referral_id;
  if not found then return false; end if;

  -- Serialize all counter changes for one referrer before locking the referral.
  perform 1
  from public.giveaway_entries as entry
  where entry.id = v_referrer_entry_id
  for update;

  select * into v_referral
  from public.giveaway_referrals as referral
  where referral.id = p_referral_id
  for update;
  if not found then return false; end if;
  if v_referral.referrer_entry_id <> v_referrer_entry_id then
    raise exception using errcode = '40001', message = 'Referral owner changed during reconciliation.';
  end if;
  if p_status = 'valid' and v_referral.join_completed_at is null then
    raise exception using errcode = '55000', message = 'Discord join is not completed.';
  end if;

  update public.giveaway_referrals
  set
    status = p_status,
    validated_at = case when p_status = 'valid' then statement_timestamp() else null end,
    invalid_reason = case
      when p_status = 'invalid' then left(coalesce(nullif(btrim(p_invalid_reason), ''), 'invalid'), 200)
      else null
    end,
    last_checked_at = statement_timestamp()
  where id = v_referral.id;

  update public.giveaway_entries
  set valid_invite_count = (
    select count(*)::integer
    from public.giveaway_referrals as referral
    where referral.referrer_entry_id = v_referrer_entry_id
      and referral.status = 'valid'
      and referral.join_completed_at is not null
  )
  where id = v_referrer_entry_id;
  return true;
end
$$;

create or replace function public.prepare_giveaway_referral(
  p_giveaway_id uuid,
  p_referral_token uuid,
  p_invitee_discord_user_id text,
  p_invitee_display_name text,
  p_invitee_avatar_url text,
  p_invitee_account_created_at timestamptz
)
returns table (
  referral_id uuid,
  referral_status public.giveaway_referral_status,
  was_created boolean,
  join_completed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
  v_entry public.giveaway_entries%rowtype;
  v_referral public.giveaway_referrals%rowtype;
begin
  if p_invitee_discord_user_id is null
    or p_invitee_discord_user_id !~ '^[0-9]{15,22}$'
    or p_invitee_display_name is null
    or btrim(p_invitee_display_name) = '' then
    raise exception using errcode = '22023', message = 'Discord invitee is invalid.';
  end if;

  select * into v_giveaway
  from public.giveaways
  where id = p_giveaway_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Giveaway was not found.';
  end if;
  if v_giveaway.status not in ('scheduled', 'active')
    or statement_timestamp() < v_giveaway.starts_at
    or statement_timestamp() >= v_giveaway.ends_at then
    raise exception using errcode = '55000', message = 'Giveaway is not accepting referrals.';
  end if;
  if p_invitee_account_created_at > statement_timestamp()
      - make_interval(days => v_giveaway.minimum_account_age_days) then
    raise exception using errcode = '42501', message = 'Discord account is too new.';
  end if;

  select * into v_entry
  from public.giveaway_entries
  where giveaway_id = v_giveaway.id
    and referral_token = p_referral_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Referral link was not found.';
  end if;
  if v_entry.discord_user_id = p_invitee_discord_user_id then
    raise exception using errcode = '42501', message = 'Self-referral is not allowed.';
  end if;

  select * into v_referral
  from public.giveaway_referrals
  where giveaway_id = v_giveaway.id
    and invitee_discord_user_id = p_invitee_discord_user_id
  for update;
  if found then
    if v_referral.referrer_entry_id <> v_entry.id then
      raise exception using errcode = '23505', message = 'Invitee is already attributed.';
    end if;
    return query
      select v_referral.id, v_referral.status, false, v_referral.join_completed_at;
    return;
  end if;

  insert into public.giveaway_referrals (
    giveaway_id,
    referrer_entry_id,
    invitee_discord_user_id,
    invitee_display_name,
    invitee_avatar_url,
    invitee_account_created_at,
    joined_at,
    join_completed_at,
    status,
    last_checked_at
  ) values (
    v_giveaway.id,
    v_entry.id,
    p_invitee_discord_user_id,
    btrim(p_invitee_display_name),
    p_invitee_avatar_url,
    p_invitee_account_created_at,
    statement_timestamp(),
    null,
    'pending'::public.giveaway_referral_status,
    null
  ) returning * into v_referral;

  return query select v_referral.id, v_referral.status, true, null::timestamptz;
end
$$;

-- Keep the previous RPC safe during rolling deployments. New code uses the
-- prepare/complete pair, but an older instance may still finish a Discord join.
create or replace function public.register_giveaway_referral(
  p_giveaway_id uuid,
  p_referral_token uuid,
  p_invitee_discord_user_id text,
  p_invitee_display_name text,
  p_invitee_avatar_url text,
  p_invitee_account_created_at timestamptz,
  p_initially_valid boolean
)
returns table (
  referral_id uuid,
  referral_status public.giveaway_referral_status,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
  v_entry public.giveaway_entries%rowtype;
  v_referral public.giveaway_referrals%rowtype;
  v_was_created boolean := false;
begin
  if p_invitee_discord_user_id is null
    or p_invitee_discord_user_id !~ '^[0-9]{15,22}$'
    or p_invitee_display_name is null
    or btrim(p_invitee_display_name) = '' then
    raise exception using errcode = '22023', message = 'Discord invitee is invalid.';
  end if;

  select * into v_giveaway
  from public.giveaways where id = p_giveaway_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Giveaway was not found.';
  end if;
  if v_giveaway.status not in ('scheduled', 'active')
    or statement_timestamp() < v_giveaway.starts_at
    or statement_timestamp() >= v_giveaway.ends_at then
    raise exception using errcode = '55000', message = 'Giveaway is not accepting referrals.';
  end if;
  if p_invitee_account_created_at > statement_timestamp()
      - make_interval(days => v_giveaway.minimum_account_age_days) then
    raise exception using errcode = '42501', message = 'Discord account is too new.';
  end if;

  select * into v_entry
  from public.giveaway_entries
  where giveaway_id = v_giveaway.id and referral_token = p_referral_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Referral link was not found.';
  end if;
  if v_entry.discord_user_id = p_invitee_discord_user_id then
    raise exception using errcode = '42501', message = 'Self-referral is not allowed.';
  end if;

  select * into v_referral
  from public.giveaway_referrals
  where giveaway_id = v_giveaway.id
    and invitee_discord_user_id = p_invitee_discord_user_id
  for update;
  if found and v_referral.referrer_entry_id <> v_entry.id then
    raise exception using errcode = '23505', message = 'Invitee is already attributed.';
  end if;

  if not found then
    insert into public.giveaway_referrals (
      giveaway_id,
      referrer_entry_id,
      invitee_discord_user_id,
      invitee_display_name,
      invitee_avatar_url,
      invitee_account_created_at,
      joined_at,
      join_completed_at,
      status,
      validated_at,
      last_checked_at
    ) values (
      v_giveaway.id,
      v_entry.id,
      p_invitee_discord_user_id,
      btrim(p_invitee_display_name),
      p_invitee_avatar_url,
      p_invitee_account_created_at,
      statement_timestamp(),
      statement_timestamp(),
      case
        when p_initially_valid then 'valid'::public.giveaway_referral_status
        else 'pending'::public.giveaway_referral_status
      end,
      case when p_initially_valid then statement_timestamp() else null end,
      statement_timestamp()
    ) returning * into v_referral;
    v_was_created := true;
  elsif v_referral.join_completed_at is null then
    update public.giveaway_referrals
    set
      invitee_display_name = btrim(p_invitee_display_name),
      invitee_avatar_url = p_invitee_avatar_url,
      joined_at = statement_timestamp(),
      join_completed_at = statement_timestamp(),
      status = case
        when p_initially_valid then 'valid'::public.giveaway_referral_status
        else 'pending'::public.giveaway_referral_status
      end,
      validated_at = case when p_initially_valid then statement_timestamp() else null end,
      invalid_reason = null,
      last_checked_at = statement_timestamp()
    where id = v_referral.id
    returning * into v_referral;
  end if;

  update public.giveaway_entries
  set valid_invite_count = (
    select count(*)::integer
    from public.giveaway_referrals as referral
    where referral.referrer_entry_id = v_entry.id
      and referral.status = 'valid'
      and referral.join_completed_at is not null
  )
  where id = v_entry.id;

  return query select v_referral.id, v_referral.status, v_was_created;
end
$$;

create or replace function public.complete_giveaway_referral_join(
  p_referral_id uuid,
  p_joined_at timestamptz,
  p_initially_valid boolean
)
returns table (
  referral_id uuid,
  referral_status public.giveaway_referral_status,
  was_completed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_referrer_entry_id uuid;
  v_giveaway_id uuid;
  v_referral public.giveaway_referrals%rowtype;
  v_giveaway public.giveaways%rowtype;
begin
  if p_joined_at is null or p_joined_at > statement_timestamp() + interval '1 minute' then
    raise exception using errcode = '22023', message = 'Discord join timestamp is invalid.';
  end if;

  select referral.referrer_entry_id, referral.giveaway_id
  into v_referrer_entry_id, v_giveaway_id
  from public.giveaway_referrals as referral
  where referral.id = p_referral_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Referral claim was not found.';
  end if;

  select * into v_giveaway
  from public.giveaways
  where id = v_giveaway_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Giveaway was not found.';
  end if;

  perform 1 from public.giveaway_entries as entry
  where entry.id = v_referrer_entry_id for update;

  select * into v_referral
  from public.giveaway_referrals as referral
  where referral.id = p_referral_id
  for update;
  if not found or v_referral.referrer_entry_id <> v_referrer_entry_id then
    raise exception using errcode = '40001', message = 'Referral claim changed during completion.';
  end if;
  if v_referral.join_completed_at is not null then
    return query select v_referral.id, v_referral.status, false;
    return;
  end if;
  if p_joined_at < v_referral.created_at - interval '2 minutes' then
    raise exception using errcode = '42501', message = 'Discord member predates the referral claim.';
  end if;

  if v_giveaway.status not in ('scheduled', 'active', 'drawing')
    or v_referral.created_at >= v_giveaway.ends_at
    or p_joined_at >= v_giveaway.ends_at then
    raise exception using errcode = '55000', message = 'Giveaway is not accepting referrals.';
  end if;

  update public.giveaway_referrals
  set
    joined_at = p_joined_at,
    join_completed_at = statement_timestamp(),
    status = case
      when p_initially_valid then 'valid'::public.giveaway_referral_status
      else 'pending'::public.giveaway_referral_status
    end,
    validated_at = case when p_initially_valid then statement_timestamp() else null end,
    invalid_reason = null,
    last_checked_at = statement_timestamp()
  where id = v_referral.id
  returning * into v_referral;

  update public.giveaway_entries
  set valid_invite_count = (
    select count(*)::integer
    from public.giveaway_referrals as referral
    where referral.referrer_entry_id = v_referrer_entry_id
      and referral.status = 'valid'
      and referral.join_completed_at is not null
  )
  where id = v_referrer_entry_id;

  return query select v_referral.id, v_referral.status, true;
end
$$;

create or replace function public.activate_due_giveaways_v2()
returns table (giveaway_id uuid)
language sql
security definer
set search_path = pg_catalog
as $$
  with activated as (
    update public.giveaways
    set status = 'active'
    where status = 'scheduled'
      and starts_at <= statement_timestamp()
      and ends_at > statement_timestamp()
    returning id
  )
  select activated.id from activated
$$;

create or replace function public.claim_due_giveaway_v2(p_claim_token uuid)
returns table (
  giveaway_id uuid,
  discord_guild_id text,
  required_valid_invites integer,
  minimum_stay_minutes integer,
  ends_at timestamptz
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
    giveaway.ends_at
  from public.giveaways as giveaway
  join public.guilds as guild on guild.id = giveaway.guild_id
  where giveaway.id = v_giveaway_id;
end
$$;

create or replace function public.mark_giveaway_entry_membership(
  p_giveaway_id uuid,
  p_claim_token uuid,
  p_entry_id uuid,
  p_is_valid boolean,
  p_invalid_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform 1
  from public.giveaways as giveaway
  where giveaway.id = p_giveaway_id
    and giveaway.status = 'drawing'
    and giveaway.processing_claim_token = p_claim_token;
  if not found then return false; end if;

  update public.giveaway_entries
  set
    membership_checked_at = statement_timestamp(),
    membership_is_valid = p_is_valid,
    membership_invalid_reason = case
      when p_is_valid then null
      else left(coalesce(nullif(btrim(p_invalid_reason), ''), 'invalid'), 200)
    end
  where id = p_entry_id
    and giveaway_id = p_giveaway_id;
  return found;
end
$$;

create or replace function public.mark_giveaway_referral_draw_status(
  p_giveaway_id uuid,
  p_claim_token uuid,
  p_referral_id uuid,
  p_is_valid boolean,
  p_invalid_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_referrer_entry_id uuid;
  v_referral public.giveaway_referrals%rowtype;
begin
  select referral.referrer_entry_id
  into v_referrer_entry_id
  from public.giveaway_referrals as referral
  where referral.id = p_referral_id
    and referral.giveaway_id = p_giveaway_id;
  if not found then return false; end if;

  perform 1
  from public.giveaways as giveaway
  where giveaway.id = p_giveaway_id
    and giveaway.status = 'drawing'
    and giveaway.processing_claim_token = p_claim_token
  for update;
  if not found then return false; end if;

  perform 1
  from public.giveaway_entries as entry
  where entry.id = v_referrer_entry_id
  for update;

  select * into v_referral
  from public.giveaway_referrals as referral
  where referral.id = p_referral_id
    and referral.giveaway_id = p_giveaway_id
  for update;
  if not found or v_referral.referrer_entry_id <> v_referrer_entry_id then return false; end if;

  update public.giveaway_referrals
  set
    status = case
      when p_is_valid then 'valid'::public.giveaway_referral_status
      else 'invalid'::public.giveaway_referral_status
    end,
    validated_at = case when p_is_valid then statement_timestamp() else null end,
    invalid_reason = case
      when p_is_valid then null
      else left(coalesce(nullif(btrim(p_invalid_reason), ''), 'invalid'), 200)
    end,
    last_checked_at = statement_timestamp(),
    draw_checked_at = statement_timestamp(),
    draw_is_valid = p_is_valid,
    draw_invalid_reason = case
      when p_is_valid then null
      else left(coalesce(nullif(btrim(p_invalid_reason), ''), 'invalid'), 200)
    end
  where id = v_referral.id;

  update public.giveaway_entries
  set valid_invite_count = (
    select count(*)::integer
    from public.giveaway_referrals as referral
    where referral.referrer_entry_id = v_referrer_entry_id
      and referral.status = 'valid'
      and referral.join_completed_at is not null
  )
  where id = v_referrer_entry_id;
  return true;
end
$$;

create or replace function public.pick_giveaway_winner(
  p_giveaway_id uuid,
  p_claim_token uuid
)
returns table (entry_id uuid, discord_user_id text)
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
  select entry.id, entry.discord_user_id
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
  order by gen_random_uuid()
  limit 1;
end
$$;

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

create or replace function public.admin_giveaway_entry_counts(p_giveaway_ids uuid[])
returns table (
  giveaway_id uuid,
  participant_count bigint,
  eligible_participant_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;
  return query
  select
    giveaway.id,
    count(entry.id),
    count(entry.id) filter (
      where entry.valid_invite_count >= giveaway.required_valid_invites
    )
  from public.giveaways as giveaway
  left join public.giveaway_entries as entry on entry.giveaway_id = giveaway.id
  where giveaway.id = any(p_giveaway_ids)
  group by giveaway.id;
end
$$;

revoke all on function public.prepare_giveaway_referral(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_giveaway_referral(
  uuid, uuid, text, text, text, timestamptz
) to service_role;

revoke all on function public.complete_giveaway_referral_join(uuid, timestamptz, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_giveaway_referral_join(uuid, timestamptz, boolean)
  to service_role;

revoke all on function public.activate_due_giveaways_v2()
  from public, anon, authenticated, service_role;
grant execute on function public.activate_due_giveaways_v2() to service_role;

revoke all on function public.claim_due_giveaway_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_giveaway_v2(uuid) to service_role;

revoke all on function public.mark_giveaway_entry_membership(uuid, uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_giveaway_entry_membership(uuid, uuid, uuid, boolean, text)
  to service_role;

revoke all on function public.mark_giveaway_referral_draw_status(uuid, uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_giveaway_referral_draw_status(uuid, uuid, uuid, boolean, text)
  to service_role;

revoke all on function public.pick_giveaway_winner(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pick_giveaway_winner(uuid, uuid) to service_role;

revoke all on function public.complete_giveaway_draw_v2(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_giveaway_draw_v2(uuid, uuid, uuid)
  to service_role;

revoke all on function public.admin_giveaway_entry_counts(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.admin_giveaway_entry_counts(uuid[]) to authenticated;

commit;
