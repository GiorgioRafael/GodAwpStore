-- Configurable Discord giveaways with exact OAuth referral attribution.
-- One winner receives the complete reserved prize package.

begin;

set local lock_timeout = '5s';

do $$
begin
  create type public.giveaway_status as enum (
    'scheduled',
    'active',
    'drawing',
    'completed',
    'cancelled',
    'failed'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.giveaway_referral_status as enum ('pending', 'valid', 'invalid');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.giveaways (
  id uuid primary key default gen_random_uuid(),
  public_slug text not null unique,
  guild_id uuid not null references public.guilds (id) on delete restrict,
  publication_channel_id text not null,
  publication_channel_name text not null,
  publication_message_id text,
  publication_error text,
  ticket_category_id text,
  ticket_category_name text,
  title text not null,
  description text not null default '',
  rules_text text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.giveaway_status not null,
  required_valid_invites integer not null default 1,
  minimum_account_age_days integer not null default 7,
  minimum_stay_minutes integer not null default 60,
  winner_entry_id uuid,
  winner_discord_user_id text,
  winner_display_name text,
  drawn_at timestamptz,
  processing_claim_token uuid,
  processing_claimed_at timestamptz,
  discord_ticket_status public.discord_ticket_status not null default 'not_created',
  discord_ticket_channel_id text,
  discord_ticket_claim_token uuid,
  discord_ticket_claimed_at timestamptz,
  failure_reason text,
  stock_reserved_at timestamptz not null default now(),
  stock_released_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references public.admin_profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint giveaways_public_slug_format check (public_slug ~ '^[a-z0-9]{12,32}$'),
  constraint giveaways_publication_channel_format check (
    publication_channel_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaways_publication_channel_name_not_blank check (
    btrim(publication_channel_name) <> ''
  ),
  constraint giveaways_publication_message_format check (
    publication_message_id is null or publication_message_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaways_ticket_category_format check (
    ticket_category_id is null or ticket_category_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaways_title_not_blank check (btrim(title) <> ''),
  constraint giveaways_title_length check (char_length(title) <= 120),
  constraint giveaways_description_length check (char_length(description) <= 2000),
  constraint giveaways_rules_length check (char_length(rules_text) <= 2000),
  constraint giveaways_schedule_valid check (
    ends_at > starts_at and ends_at <= starts_at + interval '90 days'
  ),
  constraint giveaways_valid_invites_range check (required_valid_invites between 0 and 100),
  constraint giveaways_account_age_range check (minimum_account_age_days between 0 and 3650),
  constraint giveaways_stay_range check (minimum_stay_minutes between 0 and 43200),
  constraint giveaways_winner_user_format check (
    winner_discord_user_id is null or winner_discord_user_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaways_ticket_channel_format check (
    discord_ticket_channel_id is null or discord_ticket_channel_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaways_terminal_state check (
    (
      status = 'completed'
      and winner_entry_id is not null
      and winner_discord_user_id is not null
      and winner_display_name is not null
      and drawn_at is not null
      and processing_claim_token is null
      and processing_claimed_at is null
      and stock_released_at is null
    )
    or (
      status <> 'completed'
      and winner_entry_id is null
      and winner_discord_user_id is null
      and winner_display_name is null
      and drawn_at is null
    )
  ),
  constraint giveaways_processing_claim_state check (
    (
      status = 'drawing'
      and processing_claim_token is not null
      and processing_claimed_at is not null
    )
    or (
      status <> 'drawing'
      and processing_claim_token is null
      and processing_claimed_at is null
    )
  ),
  constraint giveaways_stock_release_state check (
    stock_released_at is null or status in ('cancelled', 'failed')
  ),
  constraint giveaways_cancel_state check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  ),
  constraint giveaways_ticket_state check (
    (
      discord_ticket_status = 'open'
      and discord_ticket_channel_id is not null
      and discord_ticket_claim_token is null
      and discord_ticket_claimed_at is null
    )
    or (
      discord_ticket_status = 'creating'
      and discord_ticket_channel_id is null
      and discord_ticket_claim_token is not null
      and discord_ticket_claimed_at is not null
    )
    or (
      discord_ticket_status in ('not_created', 'failed')
      and discord_ticket_channel_id is null
      and discord_ticket_claim_token is null
      and discord_ticket_claimed_at is null
    )
  )
);

create table if not exists public.giveaway_prizes (
  giveaway_id uuid not null references public.giveaways (id) on delete restrict,
  position smallint not null,
  product_id uuid not null references public.products (id) on delete restrict,
  product_name text not null,
  quantity integer not null,
  created_at timestamptz not null default now(),
  primary key (giveaway_id, position),
  constraint giveaway_prizes_product_unique unique (giveaway_id, product_id),
  constraint giveaway_prizes_position_range check (position between 1 and 20),
  constraint giveaway_prizes_product_name_not_blank check (btrim(product_name) <> ''),
  constraint giveaway_prizes_quantity_range check (quantity between 1 and 10000)
);

create table if not exists public.giveaway_entries (
  id uuid primary key default gen_random_uuid(),
  giveaway_id uuid not null references public.giveaways (id) on delete restrict,
  discord_user_id text not null,
  display_name text not null,
  avatar_url text,
  referral_token uuid not null default gen_random_uuid() unique,
  valid_invite_count integer not null default 0,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint giveaway_entries_user_unique unique (giveaway_id, discord_user_id),
  constraint giveaway_entries_user_format check (discord_user_id ~ '^[0-9]{15,22}$'),
  constraint giveaway_entries_display_name_not_blank check (btrim(display_name) <> ''),
  constraint giveaway_entries_invite_count_nonnegative check (valid_invite_count >= 0)
);

alter table public.giveaways
  add constraint giveaways_winner_entry_fkey
  foreign key (winner_entry_id)
  references public.giveaway_entries (id)
  on delete restrict;

create table if not exists public.giveaway_referrals (
  id uuid primary key default gen_random_uuid(),
  giveaway_id uuid not null references public.giveaways (id) on delete restrict,
  referrer_entry_id uuid not null references public.giveaway_entries (id) on delete restrict,
  invitee_discord_user_id text not null,
  invitee_display_name text not null,
  invitee_avatar_url text,
  invitee_account_created_at timestamptz not null,
  joined_at timestamptz not null default now(),
  status public.giveaway_referral_status not null default 'pending',
  validated_at timestamptz,
  invalid_reason text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint giveaway_referrals_invitee_unique unique (giveaway_id, invitee_discord_user_id),
  constraint giveaway_referrals_invitee_format check (
    invitee_discord_user_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaway_referrals_invitee_name_not_blank check (
    btrim(invitee_display_name) <> ''
  ),
  constraint giveaway_referrals_status_state check (
    (status = 'pending' and validated_at is null and invalid_reason is null)
    or (status = 'valid' and validated_at is not null and invalid_reason is null)
    or (status = 'invalid' and validated_at is null and invalid_reason is not null)
  )
);

create index if not exists giveaways_guild_created_idx
  on public.giveaways (guild_id, created_at desc);
create index if not exists giveaways_status_ends_idx
  on public.giveaways (status, ends_at, id)
  where status in ('scheduled', 'active', 'drawing');
create index if not exists giveaways_ticket_reconciliation_idx
  on public.giveaways (discord_ticket_status, discord_ticket_claimed_at, id)
  where status = 'completed' and discord_ticket_status <> 'open';
create index if not exists giveaway_prizes_product_idx
  on public.giveaway_prizes (product_id, giveaway_id);
create index if not exists giveaway_entries_giveaway_eligibility_idx
  on public.giveaway_entries (giveaway_id, valid_invite_count desc, joined_at, id);
create index if not exists giveaway_referrals_referrer_status_idx
  on public.giveaway_referrals (referrer_entry_id, status, joined_at);
create index if not exists giveaway_referrals_pending_idx
  on public.giveaway_referrals (status, joined_at, id)
  where status = 'pending';

alter table public.giveaways enable row level security;
alter table public.giveaways force row level security;
alter table public.giveaway_prizes enable row level security;
alter table public.giveaway_prizes force row level security;
alter table public.giveaway_entries enable row level security;
alter table public.giveaway_entries force row level security;
alter table public.giveaway_referrals enable row level security;
alter table public.giveaway_referrals force row level security;

create policy giveaways_admin_select on public.giveaways
for select to authenticated using (private.is_admin());
create policy giveaway_prizes_admin_select on public.giveaway_prizes
for select to authenticated using (private.is_admin());
create policy giveaway_entries_admin_select on public.giveaway_entries
for select to authenticated using (private.is_admin());
create policy giveaway_referrals_admin_select on public.giveaway_referrals
for select to authenticated using (private.is_admin());

revoke all on table public.giveaways from public, anon, authenticated;
revoke all on table public.giveaway_prizes from public, anon, authenticated;
revoke all on table public.giveaway_entries from public, anon, authenticated;
revoke all on table public.giveaway_referrals from public, anon, authenticated;
grant select on table public.giveaways to authenticated;
grant select on table public.giveaway_prizes to authenticated;
grant select on table public.giveaway_entries to authenticated;
grant select on table public.giveaway_referrals to authenticated;

create trigger giveaways_set_updated_at
before update on public.giveaways
for each row execute function private.set_updated_at();
create trigger giveaway_entries_set_updated_at
before update on public.giveaway_entries
for each row execute function private.set_updated_at();
create trigger giveaway_referrals_set_updated_at
before update on public.giveaway_referrals
for each row execute function private.set_updated_at();

create or replace function public.admin_create_giveaway(
  p_public_slug text,
  p_guild_id uuid,
  p_publication_channel_id text,
  p_publication_channel_name text,
  p_ticket_category_id text,
  p_ticket_category_name text,
  p_title text,
  p_description text,
  p_rules_text text,
  p_starts_at timestamptz,
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
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
  v_product public.products%rowtype;
  v_actor_discord_id text;
  v_prize_count integer;
  v_requested_quantity integer;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;
  if p_public_slug is null or p_public_slug !~ '^[a-z0-9]{12,32}$' then
    raise exception using errcode = '22023', message = 'Public slug is invalid.';
  end if;
  if p_publication_channel_id is null
    or p_publication_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Publication channel is invalid.';
  end if;
  if p_ticket_category_id is not null
    and p_ticket_category_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Ticket category is invalid.';
  end if;
  if p_title is null or btrim(p_title) = '' or char_length(btrim(p_title)) > 120 then
    raise exception using errcode = '22023', message = 'Giveaway title is invalid.';
  end if;
  if p_ends_at <= greatest(p_starts_at, statement_timestamp())
    or p_ends_at > p_starts_at + interval '90 days' then
    raise exception using errcode = '22023', message = 'Giveaway schedule is invalid.';
  end if;
  if p_required_valid_invites not between 0 and 100
    or p_minimum_account_age_days not between 0 and 3650
    or p_minimum_stay_minutes not between 0 and 43200 then
    raise exception using errcode = '22023', message = 'Giveaway qualification rules are invalid.';
  end if;
  if p_prizes is null or jsonb_typeof(p_prizes) <> 'array'
    or jsonb_array_length(p_prizes) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'Prize package is invalid.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_prizes) as prize(value)
    where jsonb_typeof(prize.value) <> 'object'
      or coalesce(prize.value ->> 'product_id', '')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(prize.value ->> 'quantity', '') !~ '^[0-9]{1,5}$'
      or (prize.value ->> 'quantity')::integer not between 1 and 10000
  ) then
    raise exception using errcode = '22023', message = 'Prize package contains an invalid item.';
  end if;

  select count(*), count(distinct (prize.value ->> 'product_id')::uuid)
  into v_prize_count, v_requested_quantity
  from jsonb_array_elements(p_prizes) as prize(value);
  if v_prize_count <> v_requested_quantity then
    raise exception using errcode = '22023', message = 'Prize products must be unique.';
  end if;

  perform 1
  from public.guilds as guild
  where guild.id = p_guild_id
    and guild.status = 'active'
    and guild.archived_at is null;
  if not found then
    raise exception using errcode = '23503', message = 'Active guild was not found.';
  end if;

  v_prize_count := 0;
  for v_product in
    select product.*
    from public.products as product
    join (
      select
        (prize.value ->> 'product_id')::uuid as product_id,
        (prize.value ->> 'quantity')::integer as quantity
      from jsonb_array_elements(p_prizes) as prize(value)
    ) as requested on requested.product_id = product.id
    order by product.id
    for update of product
  loop
    v_prize_count := v_prize_count + 1;
    select (prize.value ->> 'quantity')::integer
    into strict v_requested_quantity
    from jsonb_array_elements(p_prizes) as prize(value)
    where (prize.value ->> 'product_id')::uuid = v_product.id;

    if v_product.status <> 'active' or v_product.archived_at is not null then
      raise exception using errcode = '23503', message = 'Prize product is not active.';
    end if;
    if v_product.stock_quantity < v_requested_quantity then
      raise exception using
        errcode = 'P0001',
        message = format('Insufficient stock for %s.', v_product.name);
    end if;
  end loop;

  if v_prize_count <> jsonb_array_length(p_prizes) then
    raise exception using errcode = '23503', message = 'Prize product was not found.';
  end if;

  insert into public.giveaways (
    public_slug,
    guild_id,
    publication_channel_id,
    publication_channel_name,
    ticket_category_id,
    ticket_category_name,
    title,
    description,
    rules_text,
    starts_at,
    ends_at,
    status,
    required_valid_invites,
    minimum_account_age_days,
    minimum_stay_minutes,
    created_by
  )
  values (
    lower(p_public_slug),
    p_guild_id,
    p_publication_channel_id,
    btrim(p_publication_channel_name),
    p_ticket_category_id,
    nullif(btrim(coalesce(p_ticket_category_name, '')), ''),
    btrim(p_title),
    btrim(coalesce(p_description, '')),
    btrim(coalesce(p_rules_text, '')),
    p_starts_at,
    p_ends_at,
    case
      when p_starts_at <= statement_timestamp() then 'active'::public.giveaway_status
      else 'scheduled'::public.giveaway_status
    end,
    p_required_valid_invites,
    p_minimum_account_age_days,
    p_minimum_stay_minutes,
    auth.uid()
  )
  returning * into v_giveaway;

  insert into public.giveaway_prizes (
    giveaway_id,
    position,
    product_id,
    product_name,
    quantity
  )
  select
    v_giveaway.id,
    prize.position::smallint,
    product.id,
    product.name,
    (prize.value ->> 'quantity')::integer
  from jsonb_array_elements(p_prizes) with ordinality as prize(value, position)
  join public.products as product
    on product.id = (prize.value ->> 'product_id')::uuid
  order by prize.position;

  update public.products as product
  set stock_quantity = product.stock_quantity - requested.quantity
  from (
    select
      (prize.value ->> 'product_id')::uuid as product_id,
      (prize.value ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_prizes) as prize(value)
  ) as requested
  where product.id = requested.product_id;

  select profile.discord_user_id
  into v_actor_discord_id
  from public.admin_profiles as profile
  where profile.auth_user_id = auth.uid();

  insert into public.audit_events (
    actor_auth_user_id,
    actor_discord_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    auth.uid(),
    v_actor_discord_id,
    'giveaway.create',
    'giveaway',
    v_giveaway.id,
    jsonb_build_object(
      'guild_id', p_guild_id,
      'prize_count', jsonb_array_length(p_prizes),
      'required_valid_invites', p_required_valid_invites
    )
  );

  return query select v_giveaway.id, v_giveaway.status, v_giveaway.public_slug;
end
$$;

create or replace function public.admin_cancel_giveaway(p_giveaway_id uuid)
returns table (cancelled_giveaway_id uuid, was_cancelled boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
  v_actor_discord_id text;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  select * into v_giveaway
  from public.giveaways
  where id = p_giveaway_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Giveaway was not found.';
  end if;
  if v_giveaway.status = 'completed' then
    raise exception using errcode = '55000', message = 'Completed giveaway cannot be cancelled.';
  end if;
  if v_giveaway.status = 'cancelled' then
    return query select v_giveaway.id, false;
    return;
  end if;

  perform 1
  from public.products as product
  join public.giveaway_prizes as prize on prize.product_id = product.id
  where prize.giveaway_id = v_giveaway.id
  order by product.id
  for update of product;

  if v_giveaway.stock_released_at is null then
    update public.products as product
    set stock_quantity = product.stock_quantity + prize.quantity
    from public.giveaway_prizes as prize
    where prize.giveaway_id = v_giveaway.id
      and prize.product_id = product.id;
  end if;

  update public.giveaways
  set
    status = 'cancelled',
    cancelled_at = statement_timestamp(),
    stock_released_at = coalesce(stock_released_at, statement_timestamp()),
    processing_claim_token = null,
    processing_claimed_at = null,
    discord_ticket_status = 'not_created',
    discord_ticket_channel_id = null,
    discord_ticket_claim_token = null,
    discord_ticket_claimed_at = null,
    failure_reason = null
  where id = v_giveaway.id;

  select profile.discord_user_id into v_actor_discord_id
  from public.admin_profiles as profile where profile.auth_user_id = auth.uid();
  insert into public.audit_events (
    actor_auth_user_id, actor_discord_user_id, action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), v_actor_discord_id, 'giveaway.cancel', 'giveaway', v_giveaway.id, '{}'::jsonb
  );

  return query select v_giveaway.id, true;
end
$$;

create or replace function public.record_giveaway_publication(
  p_giveaway_id uuid,
  p_message_id text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.role() <> 'service_role' and not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;
  if p_message_id is not null and p_message_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord message ID is invalid.';
  end if;
  update public.giveaways
  set
    publication_message_id = coalesce(p_message_id, publication_message_id),
    publication_error = case
      when p_message_id is not null then null
      else left(nullif(btrim(coalesce(p_error, '')), ''), 500)
    end
  where id = p_giveaway_id;
  return found;
end
$$;

create or replace function public.register_giveaway_participant(
  p_giveaway_id uuid,
  p_discord_user_id text,
  p_display_name text,
  p_avatar_url text
)
returns table (
  entry_id uuid,
  referral_token uuid,
  valid_invite_count integer,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
  v_entry public.giveaway_entries%rowtype;
begin
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{15,22}$'
    or p_display_name is null or btrim(p_display_name) = '' then
    raise exception using errcode = '22023', message = 'Discord participant is invalid.';
  end if;

  select * into v_giveaway
  from public.giveaways where id = p_giveaway_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Giveaway was not found.';
  end if;
  if v_giveaway.status not in ('scheduled', 'active')
    or statement_timestamp() < v_giveaway.starts_at
    or statement_timestamp() >= v_giveaway.ends_at then
    raise exception using errcode = '55000', message = 'Giveaway is not accepting participants.';
  end if;
  if v_giveaway.status = 'scheduled' then
    update public.giveaways set status = 'active' where id = v_giveaway.id;
  end if;

  select entry.* into v_entry
  from public.giveaway_entries as entry
  where entry.giveaway_id = v_giveaway.id
    and entry.discord_user_id = p_discord_user_id;
  if found then
    update public.giveaway_entries
    set display_name = btrim(p_display_name), avatar_url = p_avatar_url
    where id = v_entry.id
    returning * into v_entry;
    return query select v_entry.id, v_entry.referral_token, v_entry.valid_invite_count, false;
    return;
  end if;

  insert into public.giveaway_entries (
    giveaway_id, discord_user_id, display_name, avatar_url
  ) values (
    v_giveaway.id, p_discord_user_id, btrim(p_display_name), p_avatar_url
  ) returning * into v_entry;
  return query select v_entry.id, v_entry.referral_token, v_entry.valid_invite_count, true;
end
$$;

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
    and invitee_discord_user_id = p_invitee_discord_user_id;
  if found then
    if v_referral.referrer_entry_id <> v_entry.id then
      raise exception using errcode = '23505', message = 'Invitee is already attributed.';
    end if;
    return query select v_referral.id, v_referral.status, false;
    return;
  end if;

  insert into public.giveaway_referrals (
    giveaway_id,
    referrer_entry_id,
    invitee_discord_user_id,
    invitee_display_name,
    invitee_avatar_url,
    invitee_account_created_at,
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
    case
      when p_initially_valid then 'valid'::public.giveaway_referral_status
      else 'pending'::public.giveaway_referral_status
    end,
    case when p_initially_valid then statement_timestamp() else null end,
    statement_timestamp()
  ) returning * into v_referral;

  if p_initially_valid then
    update public.giveaway_entries
    set valid_invite_count = valid_invite_count + 1
    where id = v_entry.id;
  end if;
  return query select v_referral.id, v_referral.status, true;
end
$$;

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
  v_referral public.giveaway_referrals%rowtype;
begin
  select * into v_referral
  from public.giveaway_referrals where id = p_referral_id for update;
  if not found then return false; end if;

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
    where referral.referrer_entry_id = v_referral.referrer_entry_id
      and referral.status = 'valid'
  )
  where id = v_referral.referrer_entry_id;
  return true;
end
$$;

create or replace function public.activate_due_giveaways()
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_count integer;
begin
  update public.giveaways
  set status = 'active'
  where status = 'scheduled'
    and starts_at <= statement_timestamp()
    and ends_at > statement_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.claim_due_giveaway(p_claim_token uuid)
returns table (
  giveaway_id uuid,
  discord_guild_id text,
  required_valid_invites integer
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
      giveaway.status = 'active'
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
  select giveaway.id, guild.discord_guild_id, giveaway.required_valid_invites
  from public.giveaways as giveaway
  join public.guilds as guild on guild.id = giveaway.guild_id
  where giveaway.id = v_giveaway_id;
end
$$;

create or replace function public.complete_giveaway_draw(
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
    and valid_invite_count >= v_giveaway.required_valid_invites
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Winner is no longer eligible.';
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

create or replace function public.claim_giveaway_ticket(p_claim_token uuid)
returns table (
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
  v_giveaway_id uuid;
begin
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Claim token is required.';
  end if;

  select giveaway.id into v_giveaway_id
  from public.giveaways as giveaway
  where giveaway.status = 'completed'
    and giveaway.winner_discord_user_id is not null
    and (
      giveaway.discord_ticket_status in ('not_created', 'failed')
      or (
        giveaway.discord_ticket_status = 'creating'
        and giveaway.discord_ticket_claimed_at < statement_timestamp() - interval '5 minutes'
      )
    )
  order by giveaway.drawn_at, giveaway.id
  for update skip locked
  limit 1;
  if not found then return; end if;

  update public.giveaways
  set
    discord_ticket_status = 'creating',
    discord_ticket_claim_token = p_claim_token,
    discord_ticket_claimed_at = statement_timestamp()
  where id = v_giveaway_id;

  return query
  select
    giveaway.id,
    guild.discord_guild_id,
    giveaway.winner_discord_user_id,
    giveaway.winner_display_name,
    giveaway.ticket_category_id,
    giveaway.title,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_name', prize.product_name,
          'quantity', prize.quantity
        ) order by prize.position
      ),
      '[]'::jsonb
    )
  from public.giveaways as giveaway
  join public.guilds as guild on guild.id = giveaway.guild_id
  join public.giveaway_prizes as prize on prize.giveaway_id = giveaway.id
  where giveaway.id = v_giveaway_id
  group by giveaway.id, guild.discord_guild_id;
end
$$;

create or replace function public.complete_giveaway_ticket(
  p_giveaway_id uuid,
  p_claim_token uuid,
  p_channel_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_channel_id is null or p_channel_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord ticket channel is invalid.';
  end if;
  update public.giveaways
  set
    discord_ticket_status = 'open',
    discord_ticket_channel_id = p_channel_id,
    discord_ticket_claim_token = null,
    discord_ticket_claimed_at = null,
    failure_reason = null
  where id = p_giveaway_id
    and discord_ticket_status = 'creating'
    and discord_ticket_claim_token = p_claim_token;
  return found;
end
$$;

create or replace function public.fail_giveaway_ticket(
  p_giveaway_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.giveaways
  set
    discord_ticket_status = 'failed',
    discord_ticket_claim_token = null,
    discord_ticket_claimed_at = null,
    failure_reason = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
  where id = p_giveaway_id
    and discord_ticket_status = 'creating'
    and discord_ticket_claim_token = p_claim_token;
  return found;
end
$$;

revoke all on function public.admin_create_giveaway(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, integer, integer, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_giveaway(
  text, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, integer, integer, integer, jsonb
) to authenticated;

revoke all on function public.admin_cancel_giveaway(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_giveaway(uuid) to authenticated;

revoke all on function public.record_giveaway_publication(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_giveaway_publication(uuid, text, text)
  to authenticated, service_role;

revoke all on function public.register_giveaway_participant(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_giveaway_participant(uuid, text, text, text)
  to service_role;

revoke all on function public.register_giveaway_referral(
  uuid, uuid, text, text, text, timestamptz, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.register_giveaway_referral(
  uuid, uuid, text, text, text, timestamptz, boolean
) to service_role;

revoke all on function public.set_giveaway_referral_status(
  uuid, public.giveaway_referral_status, text
) from public, anon, authenticated, service_role;
grant execute on function public.set_giveaway_referral_status(
  uuid, public.giveaway_referral_status, text
) to service_role;

revoke all on function public.activate_due_giveaways()
  from public, anon, authenticated, service_role;
grant execute on function public.activate_due_giveaways() to service_role;

revoke all on function public.claim_due_giveaway(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_giveaway(uuid) to service_role;

revoke all on function public.complete_giveaway_draw(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_giveaway_draw(uuid, uuid, uuid) to service_role;

revoke all on function public.claim_giveaway_ticket(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_giveaway_ticket(uuid) to service_role;

revoke all on function public.complete_giveaway_ticket(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_giveaway_ticket(uuid, uuid, text) to service_role;

revoke all on function public.fail_giveaway_ticket(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_giveaway_ticket(uuid, uuid, text) to service_role;

-- Include giveaway reservations and completed prize packages in the existing
-- inventory summary without changing the live-stock source of truth.
create or replace view public.product_stock_summary
with (security_invoker = true)
as
select
  product.id as product_id,
  product.name as product_name,
  product.substore_id,
  product.stock_quantity::bigint as available_count,
  (
    coalesce(order_totals.reserved_count, 0)
    + coalesce(giveaway_totals.reserved_count, 0)
  )::bigint as reserved_count,
  (
    product.stock_quantity
    + coalesce(order_totals.reserved_count, 0)
    + coalesce(giveaway_totals.reserved_count, 0)
    + coalesce(order_totals.delivered_count, 0)
    + coalesce(giveaway_totals.delivered_count, 0)
  )::bigint as total_count,
  product.low_stock_threshold,
  (product.stock_quantity <= product.low_stock_threshold) as is_low_stock,
  (
    coalesce(order_totals.delivered_count, 0)
    + coalesce(giveaway_totals.delivered_count, 0)
  )::bigint as delivered_count,
  0::bigint as quarantined_count,
  0::bigint as revoked_count,
  product.status as product_status
from public.products as product
left join lateral (
  select
    coalesce(
      sum(item.quantity) filter (
        where order_row.status in ('pending', 'awaiting_payment', 'paid', 'processing')
      ),
      0
    )::bigint as reserved_count,
    coalesce(
      sum(item.quantity) filter (where order_row.status = 'delivered'),
      0
    )::bigint as delivered_count
  from public.order_items as item
  join public.orders as order_row on order_row.id = item.order_id
  where item.product_id = product.id
) as order_totals on true
left join lateral (
  select
    coalesce(
      sum(prize.quantity) filter (
        where giveaway.status in ('scheduled', 'active', 'drawing')
      ),
      0
    )::bigint as reserved_count,
    coalesce(
      sum(prize.quantity) filter (where giveaway.status = 'completed'),
      0
    )::bigint as delivered_count
  from public.giveaway_prizes as prize
  join public.giveaways as giveaway on giveaway.id = prize.giveaway_id
  where prize.product_id = product.id
) as giveaway_totals on true;

commit;
