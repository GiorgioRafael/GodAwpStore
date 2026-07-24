-- Attribute giveaway referrals from native Discord invite usage observed by the
-- persistent gateway worker. OAuth referral links remain supported for rows
-- created before this feature and for rolling deployments.

begin;

set local lock_timeout = '5s';

create table if not exists public.discord_native_invite_events (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds (id) on delete restrict,
  discord_guild_id text not null,
  invitee_discord_user_id text not null,
  invitee_display_name text not null,
  invitee_avatar_url text,
  invitee_account_created_at timestamptz not null,
  joined_at timestamptz not null,
  invite_code text,
  inviter_discord_user_id text,
  status text not null,
  details jsonb not null default '{}'::jsonb,
  affected_giveaway_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_native_invite_events_join_unique unique (
    guild_id,
    invitee_discord_user_id,
    joined_at
  ),
  constraint discord_native_invite_events_guild_format check (
    discord_guild_id ~ '^[0-9]{15,22}$'
  ),
  constraint discord_native_invite_events_invitee_format check (
    invitee_discord_user_id ~ '^[0-9]{15,22}$'
  ),
  constraint discord_native_invite_events_inviter_format check (
    inviter_discord_user_id is null
    or inviter_discord_user_id ~ '^[0-9]{15,22}$'
  ),
  constraint discord_native_invite_events_name_not_blank check (
    btrim(invitee_display_name) <> ''
  ),
  constraint discord_native_invite_events_code_format check (
    invite_code is null or invite_code ~ '^[A-Za-z0-9_-]{2,100}$'
  ),
  constraint discord_native_invite_events_status check (
    status in ('attributed', 'ambiguous', 'unattributed', 'ignored', 'failed')
  ),
  constraint discord_native_invite_events_attribution_state check (
    status <> 'attributed'
    or (invite_code is not null and inviter_discord_user_id is not null)
  ),
  constraint discord_native_invite_events_details_object check (
    jsonb_typeof(details) = 'object'
  ),
  constraint discord_native_invite_events_affected_nonnegative check (
    affected_giveaway_count >= 0
  ),
  constraint discord_native_invite_events_account_created_before_join check (
    invitee_account_created_at <= joined_at
  )
);

create table if not exists public.discord_native_invite_snapshots (
  guild_id uuid not null references public.guilds (id) on delete cascade,
  invite_code text not null,
  inviter_discord_user_id text,
  channel_id text,
  uses integer not null,
  max_uses integer,
  created_at_discord timestamptz,
  expires_at timestamptz,
  last_seen_at timestamptz not null default now(),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (guild_id, invite_code),
  constraint discord_native_invite_snapshots_code_format check (
    invite_code ~ '^[A-Za-z0-9_-]{2,100}$'
  ),
  constraint discord_native_invite_snapshots_inviter_format check (
    inviter_discord_user_id is null
    or inviter_discord_user_id ~ '^[0-9]{15,22}$'
  ),
  constraint discord_native_invite_snapshots_channel_format check (
    channel_id is null or channel_id ~ '^[0-9]{15,22}$'
  ),
  constraint discord_native_invite_snapshots_uses_nonnegative check (uses >= 0),
  constraint discord_native_invite_snapshots_max_uses_nonnegative check (
    max_uses is null or max_uses >= 0
  )
);

alter table public.giveaway_referrals
  add column if not exists attribution_source text not null default 'oauth_link',
  add column if not exists native_invite_code text,
  add column if not exists native_inviter_discord_user_id text,
  add column if not exists native_invite_event_id uuid
    references public.discord_native_invite_events (id) on delete restrict;

alter table public.giveaway_referrals
  drop constraint if exists giveaway_referrals_attribution_source_check,
  add constraint giveaway_referrals_attribution_source_check check (
    attribution_source in ('oauth_link', 'discord_native')
  ),
  drop constraint if exists giveaway_referrals_native_code_format,
  add constraint giveaway_referrals_native_code_format check (
    native_invite_code is null
    or native_invite_code ~ '^[A-Za-z0-9_-]{2,100}$'
  ),
  drop constraint if exists giveaway_referrals_native_inviter_format,
  add constraint giveaway_referrals_native_inviter_format check (
    native_inviter_discord_user_id is null
    or native_inviter_discord_user_id ~ '^[0-9]{15,22}$'
  ),
  drop constraint if exists giveaway_referrals_attribution_state,
  add constraint giveaway_referrals_attribution_state check (
    (
      attribution_source = 'oauth_link'
      and native_invite_code is null
      and native_inviter_discord_user_id is null
      and native_invite_event_id is null
    )
    or (
      attribution_source = 'discord_native'
      and native_invite_code is not null
      and native_inviter_discord_user_id is not null
      and native_invite_event_id is not null
    )
  );

create index if not exists discord_native_invite_events_guild_created_idx
  on public.discord_native_invite_events (guild_id, created_at desc);
create index if not exists discord_native_invite_events_status_created_idx
  on public.discord_native_invite_events (status, created_at desc);
create index if not exists discord_native_invite_snapshots_last_seen_idx
  on public.discord_native_invite_snapshots (guild_id, last_seen_at desc);
create index if not exists giveaway_referrals_native_event_idx
  on public.giveaway_referrals (native_invite_event_id)
  where native_invite_event_id is not null;

alter table public.discord_native_invite_events enable row level security;
alter table public.discord_native_invite_events force row level security;
alter table public.discord_native_invite_snapshots enable row level security;
alter table public.discord_native_invite_snapshots force row level security;

revoke all on table public.discord_native_invite_events
  from public, anon, authenticated, service_role;
revoke all on table public.discord_native_invite_snapshots
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.discord_native_invite_events to service_role;
grant select, insert, update, delete on table public.discord_native_invite_snapshots to service_role;

create trigger discord_native_invite_events_set_updated_at
before update on public.discord_native_invite_events
for each row execute function private.set_updated_at();

create trigger discord_native_invite_snapshots_set_updated_at
before update on public.discord_native_invite_snapshots
for each row execute function private.set_updated_at();

create or replace function public.record_discord_native_invite_join(
  p_discord_guild_id text,
  p_invitee_discord_user_id text,
  p_invitee_display_name text,
  p_invitee_avatar_url text,
  p_invitee_account_created_at timestamptz,
  p_joined_at timestamptz,
  p_invitee_is_pending boolean,
  p_attribution_status text,
  p_invite_code text,
  p_inviter_discord_user_id text,
  p_details jsonb
)
returns table (
  invite_event_id uuid,
  event_status text,
  affected_giveaway_count integer,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_guild public.guilds%rowtype;
  v_event public.discord_native_invite_events%rowtype;
  v_giveaway record;
  v_referral_status public.giveaway_referral_status;
  v_invalid_reason text;
  v_affected_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;
  if p_discord_guild_id is null
    or p_discord_guild_id !~ '^[0-9]{15,22}$'
    or p_invitee_discord_user_id is null
    or p_invitee_discord_user_id !~ '^[0-9]{15,22}$'
    or p_invitee_display_name is null
    or btrim(p_invitee_display_name) = '' then
    raise exception using errcode = '22023', message = 'Discord member identity is invalid.';
  end if;
  if p_invitee_account_created_at is null
    or p_joined_at is null
    or p_invitee_account_created_at > p_joined_at
    or p_joined_at > statement_timestamp() + interval '2 minutes'
    or p_joined_at < statement_timestamp() - interval '7 days' then
    raise exception using errcode = '22023', message = 'Discord member timestamps are invalid.';
  end if;
  if p_attribution_status not in ('attributed', 'ambiguous', 'unattributed', 'ignored', 'failed') then
    raise exception using errcode = '22023', message = 'Native invite attribution status is invalid.';
  end if;
  if p_details is not null
    and (jsonb_typeof(p_details) <> 'object' or pg_column_size(p_details) > 8192) then
    raise exception using errcode = '22023', message = 'Native invite details are invalid.';
  end if;
  if p_attribution_status = 'attributed' and (
    p_invite_code is null
    or p_invite_code !~ '^[A-Za-z0-9_-]{2,100}$'
    or p_inviter_discord_user_id is null
    or p_inviter_discord_user_id !~ '^[0-9]{15,22}$'
  ) then
    raise exception using errcode = '22023', message = 'Native invite attribution is incomplete.';
  end if;
  if p_invite_code is not null and p_invite_code !~ '^[A-Za-z0-9_-]{2,100}$' then
    raise exception using errcode = '22023', message = 'Discord invite code is invalid.';
  end if;
  if p_inviter_discord_user_id is not null
    and p_inviter_discord_user_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord inviter is invalid.';
  end if;

  select * into v_guild
  from public.guilds
  where discord_guild_id = p_discord_guild_id
    and status = 'active'
    and archived_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active Discord guild was not found.';
  end if;

  select * into v_event
  from public.discord_native_invite_events
  where guild_id = v_guild.id
    and invitee_discord_user_id = p_invitee_discord_user_id
    and joined_at = p_joined_at;
  if found then
    return query
      select v_event.id, v_event.status, v_event.affected_giveaway_count, false;
    return;
  end if;

  insert into public.discord_native_invite_events (
    guild_id,
    discord_guild_id,
    invitee_discord_user_id,
    invitee_display_name,
    invitee_avatar_url,
    invitee_account_created_at,
    joined_at,
    invite_code,
    inviter_discord_user_id,
    status,
    details
  ) values (
    v_guild.id,
    p_discord_guild_id,
    p_invitee_discord_user_id,
    left(btrim(p_invitee_display_name), 100),
    p_invitee_avatar_url,
    p_invitee_account_created_at,
    p_joined_at,
    p_invite_code,
    p_inviter_discord_user_id,
    p_attribution_status,
    coalesce(p_details, '{}'::jsonb)
  )
  returning * into v_event;

  if p_attribution_status = 'attributed'
    and p_inviter_discord_user_id <> p_invitee_discord_user_id then
    for v_giveaway in
      select
        giveaway.id,
        giveaway.minimum_account_age_days,
        giveaway.minimum_stay_minutes,
        entry.id as entry_id
      from public.giveaways as giveaway
      join public.giveaway_entries as entry
        on entry.giveaway_id = giveaway.id
       and entry.discord_user_id = p_inviter_discord_user_id
       and entry.joined_at <= p_joined_at
      where giveaway.guild_id = v_guild.id
        and giveaway.status in ('scheduled', 'active', 'drawing')
        and giveaway.starts_at <= p_joined_at
        and giveaway.ends_at > p_joined_at
        and giveaway.required_valid_invites > 0
      order by giveaway.id
      for update of giveaway
    loop
      if p_invitee_account_created_at
          > p_joined_at - make_interval(days => v_giveaway.minimum_account_age_days) then
        v_referral_status := 'invalid'::public.giveaway_referral_status;
        v_invalid_reason := 'account_too_new';
      elsif v_giveaway.minimum_stay_minutes = 0
        and not coalesce(p_invitee_is_pending, false) then
        v_referral_status := 'valid'::public.giveaway_referral_status;
        v_invalid_reason := null;
      else
        v_referral_status := 'pending'::public.giveaway_referral_status;
        v_invalid_reason := null;
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
        validated_at,
        invalid_reason,
        last_checked_at,
        attribution_source,
        native_invite_code,
        native_inviter_discord_user_id,
        native_invite_event_id
      ) values (
        v_giveaway.id,
        v_giveaway.entry_id,
        p_invitee_discord_user_id,
        left(btrim(p_invitee_display_name), 100),
        p_invitee_avatar_url,
        p_invitee_account_created_at,
        p_joined_at,
        p_joined_at,
        v_referral_status,
        case when v_referral_status = 'valid' then statement_timestamp() else null end,
        v_invalid_reason,
        case when v_referral_status <> 'pending' then statement_timestamp() else null end,
        'discord_native',
        p_invite_code,
        p_inviter_discord_user_id,
        v_event.id
      )
      on conflict (giveaway_id, invitee_discord_user_id) do nothing;

      if found then
        v_affected_count := v_affected_count + 1;
      end if;
    end loop;

    update public.giveaway_entries as entry
    set valid_invite_count = (
      select count(*)::integer
      from public.giveaway_referrals as referral
      where referral.referrer_entry_id = entry.id
        and referral.status = 'valid'
        and referral.join_completed_at is not null
    )
    where entry.discord_user_id = p_inviter_discord_user_id
      and exists (
        select 1
        from public.giveaways as giveaway
        where giveaway.id = entry.giveaway_id
          and giveaway.guild_id = v_guild.id
          and giveaway.starts_at <= p_joined_at
          and giveaway.ends_at > p_joined_at
      );
  end if;

  update public.discord_native_invite_events
  set
    status = case
      when p_attribution_status = 'attributed' and v_affected_count = 0 then 'ignored'
      else p_attribution_status
    end,
    affected_giveaway_count = v_affected_count
  where id = v_event.id
  returning * into v_event;

  return query
    select v_event.id, v_event.status, v_event.affected_giveaway_count, true;
end
$$;

revoke all on function public.record_discord_native_invite_join(
  text, text, text, text, timestamptz, timestamptz, boolean, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_discord_native_invite_join(
  text, text, text, text, timestamptz, timestamptz, boolean, text, text, text, jsonb
) to service_role;

commit;
