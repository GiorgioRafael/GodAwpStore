begin;

create or replace function private.valid_unique_discord_user_ids(p_user_ids text[])
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select
    (
      cardinality(p_user_ids) = 0
      or array_ndims(p_user_ids) = 1
    )
    and (
      select
        count(*) = count(user_id)
        and count(*) = count(distinct user_id)
        and coalesce(bool_and(user_id ~ '^[0-9]{15,22}$'), true)
      from unnest(p_user_ids) as notification_user(user_id)
    );
$$;

comment on function private.valid_unique_discord_user_ids(text[]) is
  'Validates a one-dimensional, duplicate-free array of Discord user snowflakes.';

revoke all on function private.valid_unique_discord_user_ids(text[])
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
grant execute on function private.valid_unique_discord_user_ids(text[])
  to authenticated, service_role;

alter table public.platform_settings
  add column if not exists ticket_notification_discord_user_ids text[];

update public.platform_settings
set ticket_notification_discord_user_ids = array['385924725332901909']::text[]
where ticket_notification_discord_user_ids is null;

alter table public.platform_settings
  alter column ticket_notification_discord_user_ids
    set default array['385924725332901909']::text[],
  alter column ticket_notification_discord_user_ids
    set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_ticket_notification_ids_cardinality'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_ticket_notification_ids_cardinality
      check (cardinality(ticket_notification_discord_user_ids) between 0 and 25);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_ticket_notification_ids_valid'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_ticket_notification_ids_valid
      check (
        private.valid_unique_discord_user_ids(ticket_notification_discord_user_ids)
      );
  end if;
end
$$;

comment on column public.platform_settings.ticket_notification_discord_user_ids is
  'Ordered global allowlist of Discord users explicitly mentioned when a paid-order ticket is opened.';

-- platform_settings already grants authenticated reads and updates behind its
-- forced admin-only RLS policy. Keep the bot read path explicit and anonymous
-- access denied as defense in depth.
revoke all on table public.platform_settings from public, anon;
grant select on table public.platform_settings to service_role;

commit;
