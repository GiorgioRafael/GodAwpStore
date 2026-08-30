begin;

-- New giveaways should be open to everyone unless the owner explicitly
-- enables the native-invite rule in the panel.
alter table public.giveaways
  alter column required_valid_invites set default 0;

comment on column public.giveaways.required_valid_invites is
  'Number of valid native Discord invites required per participant. Defaults to zero.';

commit;
