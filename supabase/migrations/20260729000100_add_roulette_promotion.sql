-- Keep the public roulette announcement editable from the same admin screen
-- that owns the wheel. Discord snowflakes stay nullable until the first
-- publication, while the visible copy always has a safe default.

begin;

set local lock_timeout = '5s';

alter table public.platform_settings
  add column if not exists roulette_promotion_title text
    not null default 'A roleta da GWStore chegou',
  add column if not exists roulette_promotion_description text
    not null default 'Agora a GWStore tem uma roleta para você conseguir seus itens dentro do Grow a Garden 2. Gire, descubra seu prêmio e acompanhe tudo pelo site.',
  add column if not exists roulette_promotion_button_label text
    not null default 'Abrir a roleta',
  add column if not exists roulette_promotion_channel_id text,
  add column if not exists roulette_promotion_message_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_roulette_promotion_copy_valid'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_roulette_promotion_copy_valid
      check (
        char_length(btrim(roulette_promotion_title)) between 1 and 120
        and char_length(btrim(roulette_promotion_description)) between 1 and 1000
        and char_length(btrim(roulette_promotion_button_label)) between 1 and 80
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_roulette_promotion_channel_valid'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_roulette_promotion_channel_valid
      check (
        roulette_promotion_channel_id is null
        or roulette_promotion_channel_id ~ '^[0-9]{15,22}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_settings_roulette_promotion_message_valid'
      and conrelid = 'public.platform_settings'::regclass
  ) then
    alter table public.platform_settings
      add constraint platform_settings_roulette_promotion_message_valid
      check (
        roulette_promotion_message_id is null
        or roulette_promotion_message_id ~ '^[0-9]{15,22}$'
      );
  end if;
end
$$;

comment on column public.platform_settings.roulette_promotion_title is
  'Editable title of the GWStore roulette announcement on Discord.';
comment on column public.platform_settings.roulette_promotion_description is
  'Editable body copy of the GWStore roulette announcement on Discord.';
comment on column public.platform_settings.roulette_promotion_button_label is
  'Editable label of the link button in the roulette announcement.';
comment on column public.platform_settings.roulette_promotion_channel_id is
  'Discord channel that contains the roulette announcement.';
comment on column public.platform_settings.roulette_promotion_message_id is
  'Discord message edited whenever the roulette announcement copy is saved.';

-- platform_settings already has forced admin-only RLS. Keep the worker read
-- path and anonymous denial explicit after altering the table.
revoke all on table public.platform_settings from public, anon;
grant select on table public.platform_settings to service_role;

commit;
