alter table public.platform_settings
  add column if not exists roulette_promotion_banner_url text;

alter table public.platform_settings
  drop constraint if exists platform_settings_roulette_promotion_banner_url_format;

alter table public.platform_settings
  add constraint platform_settings_roulette_promotion_banner_url_format
  check (
    roulette_promotion_banner_url is null
    or roulette_promotion_banner_url ~ '^https://[^[:space:]]+$'
  );

comment on column public.platform_settings.roulette_promotion_banner_url is
  'Optional HTTPS banner used by the Discord roulette promotion. A deployment-specific default is used when null.';
