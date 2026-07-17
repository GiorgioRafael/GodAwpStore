begin;

alter table public.platform_settings
  add column if not exists bot_message_config jsonb not null default '{"version":1}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_bot_message_config_object'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_bot_message_config_object
      check (jsonb_typeof(bot_message_config) = 'object');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_bot_message_config_version'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_bot_message_config_version
      check (bot_message_config @> '{"version":1}'::jsonb);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_bot_message_config_size'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_bot_message_config_size
      check (octet_length(bot_message_config::text) <= 65536);
  end if;
end
$$;

comment on column public.platform_settings.bot_message_config is
  'Versioned global presentation and text templates for Discord storefronts, interactions and paid-order tickets.';

commit;
