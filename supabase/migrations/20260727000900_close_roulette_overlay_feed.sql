-- Close the overlay feed to anonymous readers.
-- The first revision let the publishable key subscribe to the feed directly,
-- which broke the store-wide invariant that no policy in the public schema
-- grants anon. The overlay now polls a server action that reads with the
-- service role instead, so the table goes back to being server-only and the
-- masked feed is never exposed to the browser key.

begin;

set local lock_timeout = '5s';

drop policy if exists roulette_overlay_events_public_select on public.roulette_overlay_events;

revoke all on table public.roulette_overlay_events from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'roulette_overlay_events'
  ) then
    execute 'alter publication supabase_realtime drop table public.roulette_overlay_events';
  end if;
end
$$;

comment on table public.roulette_overlay_events is
  'Masked roulette spin feed for the live overlay. Server-only: the overlay page reads it through a token-gated server action.';

commit;
