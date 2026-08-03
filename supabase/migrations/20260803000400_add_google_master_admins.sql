begin;

alter table public.admin_profiles
  alter column discord_user_id drop not null;

alter table public.admin_profiles
  add column if not exists google_email text;

alter table public.admin_profiles
  drop constraint if exists admin_profiles_identity_present;

alter table public.admin_profiles
  add constraint admin_profiles_identity_present
  check (discord_user_id is not null or google_email is not null);

alter table public.admin_profiles
  drop constraint if exists admin_profiles_google_email_normalized;

alter table public.admin_profiles
  add constraint admin_profiles_google_email_normalized
  check (
    google_email is null
    or (
      google_email = lower(btrim(google_email))
      and google_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create unique index if not exists admin_profiles_google_email_unique
  on public.admin_profiles (lower(google_email))
  where google_email is not null;

comment on column public.admin_profiles.google_email is
  'Verified Google OAuth email used by the private 101Devs master administration panel.';

commit;
