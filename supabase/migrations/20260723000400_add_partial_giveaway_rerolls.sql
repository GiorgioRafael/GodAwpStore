-- Allow administrators to replace one or more no-show winners while keeping
-- an audit trail, preventing repeat winners, and cleaning up obsolete tickets.

begin;

set local lock_timeout = '5s';

create table public.giveaway_rerolls (
  id uuid primary key default gen_random_uuid(),
  giveaway_id uuid not null references public.giveaways (id) on delete cascade,
  replaced_winner_count smallint not null
    check (replaced_winner_count between 1 and 100),
  announcement_message_id text,
  announcement_error text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  constraint giveaway_rerolls_announcement_message_format check (
    announcement_message_id is null
    or announcement_message_id ~ '^[0-9]{15,22}$'
  )
);

create index giveaway_rerolls_pending_announcement_idx
  on public.giveaway_rerolls (created_at, id)
  where announcement_message_id is null;

create table public.giveaway_winner_history (
  id uuid primary key default gen_random_uuid(),
  reroll_id uuid not null references public.giveaway_rerolls (id) on delete cascade,
  giveaway_id uuid not null references public.giveaways (id) on delete cascade,
  winner_id uuid not null,
  entry_id uuid not null references public.giveaway_entries (id) on delete restrict,
  winner_position smallint not null,
  discord_user_id text not null,
  display_name text not null,
  ticket_channel_id text,
  ticket_cleanup_status text not null default 'complete'
    check (ticket_cleanup_status in ('pending', 'deleting', 'complete', 'failed')),
  ticket_cleanup_claim_token uuid,
  ticket_cleanup_claimed_at timestamptz,
  ticket_cleanup_error text,
  replaced_at timestamptz not null default now(),
  constraint giveaway_winner_history_winner_unique unique (winner_id),
  constraint giveaway_winner_history_user_format check (
    discord_user_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaway_winner_history_channel_format check (
    ticket_channel_id is null or ticket_channel_id ~ '^[0-9]{15,22}$'
  ),
  constraint giveaway_winner_history_cleanup_state check (
    (
      ticket_cleanup_status = 'complete'
      and ticket_cleanup_claim_token is null
      and ticket_cleanup_claimed_at is null
    )
    or (
      ticket_cleanup_status = 'deleting'
      and ticket_channel_id is not null
      and ticket_cleanup_claim_token is not null
      and ticket_cleanup_claimed_at is not null
    )
    or (
      ticket_cleanup_status in ('pending', 'failed')
      and ticket_channel_id is not null
      and ticket_cleanup_claim_token is null
      and ticket_cleanup_claimed_at is null
    )
  )
);

create index giveaway_winner_history_cleanup_idx
  on public.giveaway_winner_history (ticket_cleanup_status, replaced_at, id)
  where ticket_cleanup_status in ('pending', 'failed', 'deleting');

create index giveaway_winner_history_giveaway_entry_idx
  on public.giveaway_winner_history (giveaway_id, entry_id);

alter table public.giveaway_rerolls enable row level security;
alter table public.giveaway_rerolls force row level security;
alter table public.giveaway_winner_history enable row level security;
alter table public.giveaway_winner_history force row level security;

revoke all on table public.giveaway_rerolls from public, anon, authenticated;
revoke all on table public.giveaway_winner_history from public, anon, authenticated;
grant select, insert, update on table public.giveaway_rerolls to service_role;
grant select, insert, update, delete on table public.giveaway_winner_history to service_role;

create or replace function public.admin_reroll_giveaway_winners(
  p_giveaway_id uuid,
  p_winner_ids uuid[],
  p_replacement_entry_ids uuid[]
)
returns table (
  reroll_id uuid,
  history_id uuid,
  replaced_ticket_channel_id text,
  new_winner_id uuid,
  winner_position smallint,
  new_winner_discord_user_id text,
  new_winner_display_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_giveaway public.giveaways%rowtype;
  v_reroll_id uuid := gen_random_uuid();
  v_requested_count integer;
  v_actor_discord_id text;
begin
  if not private.is_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  v_requested_count := coalesce(cardinality(p_winner_ids), 0);
  if v_requested_count < 1 or v_requested_count > 100 then
    raise exception using errcode = '22023', message = 'Selecione de 1 a 100 ganhadores.';
  end if;
  if coalesce(cardinality(p_replacement_entry_ids), 0) <> v_requested_count then
    raise exception using errcode = '22023', message = 'A quantidade de substitutos é inválida.';
  end if;
  if (
    select count(distinct value)
    from unnest(p_winner_ids) as selected(value)
  ) <> v_requested_count then
    raise exception using errcode = '22023', message = 'Há ganhadores repetidos na seleção.';
  end if;
  if (
    select count(distinct value)
    from unnest(p_replacement_entry_ids) as selected(value)
  ) <> v_requested_count then
    raise exception using errcode = '22023', message = 'Há substitutos repetidos na seleção.';
  end if;

  select * into v_giveaway
  from public.giveaways
  where id = p_giveaway_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Giveaway was not found.';
  end if;
  if v_giveaway.status <> 'completed' then
    raise exception using errcode = '55000', message = 'Only completed giveaways can be rerolled.';
  end if;

  perform 1
  from public.giveaway_winners as winner
  where winner.giveaway_id = p_giveaway_id
    and winner.id = any(p_winner_ids)
  order by winner.id
  for update;
  if (
    select count(*)
    from public.giveaway_winners as winner
    where winner.giveaway_id = p_giveaway_id
      and winner.id = any(p_winner_ids)
  ) <> v_requested_count then
    raise exception using errcode = '22023', message = 'Um ganhador selecionado não pertence ao sorteio.';
  end if;
  if exists (
    select 1
    from public.giveaway_winners as winner
    where winner.giveaway_id = p_giveaway_id
      and winner.id = any(p_winner_ids)
      and winner.ticket_status = 'creating'
  ) then
    raise exception using
      errcode = '55000',
      message = 'A ticket for a selected winner is still being created.';
  end if;

  perform 1
  from public.giveaway_entries as entry
  where entry.giveaway_id = p_giveaway_id
    and entry.id = any(p_replacement_entry_ids)
  order by entry.id
  for update;
  if (
    select count(*)
    from public.giveaway_entries as entry
    where entry.giveaway_id = p_giveaway_id
      and entry.id = any(p_replacement_entry_ids)
      and entry.membership_is_valid
      and entry.valid_invite_count >= v_giveaway.required_valid_invites
  ) <> v_requested_count then
    raise exception using errcode = '55000', message = 'Um substituto deixou de ser elegível.';
  end if;
  if exists (
    select 1
    from public.giveaway_winners as winner
    where winner.giveaway_id = p_giveaway_id
      and winner.entry_id = any(p_replacement_entry_ids)
  ) or exists (
    select 1
    from public.giveaway_winner_history as history
    where history.giveaway_id = p_giveaway_id
      and history.entry_id = any(p_replacement_entry_ids)
  ) then
    raise exception using errcode = '23505', message = 'Um substituto já foi ganhador deste sorteio.';
  end if;

  insert into public.giveaway_rerolls (
    id,
    giveaway_id,
    replaced_winner_count,
    requested_by
  )
  values (
    v_reroll_id,
    p_giveaway_id,
    v_requested_count,
    auth.uid()
  );

  insert into public.giveaway_winner_history (
    reroll_id,
    giveaway_id,
    winner_id,
    entry_id,
    winner_position,
    discord_user_id,
    display_name,
    ticket_channel_id,
    ticket_cleanup_status,
    ticket_cleanup_claim_token,
    ticket_cleanup_claimed_at
  )
  select
    v_reroll_id,
    winner.giveaway_id,
    winner.id,
    winner.entry_id,
    winner.winner_position,
    winner.discord_user_id,
    winner.display_name,
    winner.ticket_channel_id,
    case when winner.ticket_channel_id is null then 'complete' else 'deleting' end,
    case when winner.ticket_channel_id is null then null else v_reroll_id end,
    case when winner.ticket_channel_id is null then null else statement_timestamp() end
  from public.giveaway_winners as winner
  where winner.giveaway_id = p_giveaway_id
    and winner.id = any(p_winner_ids);

  delete from public.giveaway_winners
  where giveaway_id = p_giveaway_id
    and id = any(p_winner_ids);

  with positions as (
    select
      history.winner_position,
      row_number() over (order by history.winner_position) as ordinal
    from public.giveaway_winner_history as history
    where history.reroll_id = v_reroll_id
  ),
  replacements as (
    select
      entry.id,
      entry.discord_user_id,
      entry.display_name,
      selected.ordinal
    from unnest(p_replacement_entry_ids) with ordinality as selected(entry_id, ordinal)
    join public.giveaway_entries as entry on entry.id = selected.entry_id
  )
  insert into public.giveaway_winners (
    giveaway_id,
    entry_id,
    winner_position,
    discord_user_id,
    display_name
  )
  select
    p_giveaway_id,
    replacement.id,
    position.winner_position,
    replacement.discord_user_id,
    replacement.display_name
  from positions as position
  join replacements as replacement on replacement.ordinal = position.ordinal;

  update public.giveaways as giveaway
  set
    winner_entry_id = winner.entry_id,
    winner_discord_user_id = winner.discord_user_id,
    winner_display_name = winner.display_name,
    discord_ticket_status = winner.ticket_status,
    discord_ticket_channel_id = winner.ticket_channel_id,
    discord_ticket_claim_token = winner.ticket_claim_token,
    discord_ticket_claimed_at = winner.ticket_claimed_at,
    failure_reason = null
  from public.giveaway_winners as winner
  where giveaway.id = p_giveaway_id
    and winner.giveaway_id = giveaway.id
    and winner.winner_position = 1;

  select profile.discord_user_id into v_actor_discord_id
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
    'giveaway.reroll',
    'giveaway',
    p_giveaway_id,
    jsonb_build_object(
      'reroll_id', v_reroll_id,
      'replaced_winner_count', v_requested_count,
      'winner_ids', to_jsonb(p_winner_ids),
      'replacement_entry_ids', to_jsonb(p_replacement_entry_ids)
    )
  );

  return query
  select
    v_reroll_id,
    history.id,
    history.ticket_channel_id,
    winner.id,
    winner.winner_position,
    winner.discord_user_id,
    winner.display_name
  from public.giveaway_winner_history as history
  join public.giveaway_winners as winner
    on winner.giveaway_id = history.giveaway_id
    and winner.winner_position = history.winner_position
  where history.reroll_id = v_reroll_id
  order by history.winner_position;
end
$$;

create or replace function public.record_giveaway_reroll_publication(
  p_reroll_id uuid,
  p_message_id text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;
  if p_message_id is not null and p_message_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord message ID is invalid.';
  end if;

  update public.giveaway_rerolls
  set
    announcement_message_id = coalesce(p_message_id, announcement_message_id),
    announcement_error = p_error
  where id = p_reroll_id;
  return found;
end
$$;

create or replace function public.record_giveaway_reroll_ticket_cleanup(
  p_history_id uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;

  update public.giveaway_winner_history
  set
    ticket_cleanup_status = case when p_error is null then 'complete' else 'failed' end,
    ticket_cleanup_claim_token = null,
    ticket_cleanup_claimed_at = null,
    ticket_cleanup_error = left(p_error, 1000)
  where id = p_history_id
    and ticket_cleanup_status = 'deleting'
    and ticket_cleanup_claim_token = p_claim_token;
  return found;
end
$$;

create or replace function public.claim_giveaway_reroll_ticket_cleanup(
  p_claim_token uuid
)
returns table (
  history_id uuid,
  giveaway_id uuid,
  ticket_channel_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_history_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Claim token is required.';
  end if;

  select history.id into v_history_id
  from public.giveaway_winner_history as history
  where history.ticket_channel_id is not null
    and (
      history.ticket_cleanup_status in ('pending', 'failed')
      or (
        history.ticket_cleanup_status = 'deleting'
        and history.ticket_cleanup_claimed_at < statement_timestamp() - interval '5 minutes'
      )
    )
  order by history.replaced_at, history.id
  for update skip locked
  limit 1;
  if not found then return; end if;

  update public.giveaway_winner_history
  set
    ticket_cleanup_status = 'deleting',
    ticket_cleanup_claim_token = p_claim_token,
    ticket_cleanup_claimed_at = statement_timestamp(),
    ticket_cleanup_error = null
  where id = v_history_id;

  return query
  select history.id, history.giveaway_id, history.ticket_channel_id
  from public.giveaway_winner_history as history
  where history.id = v_history_id;
end
$$;

revoke all on function public.admin_reroll_giveaway_winners(uuid, uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.admin_reroll_giveaway_winners(uuid, uuid[], uuid[])
  to authenticated;

revoke all on function public.record_giveaway_reroll_publication(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_giveaway_reroll_publication(uuid, text, text)
  to service_role;

revoke all on function public.record_giveaway_reroll_ticket_cleanup(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_giveaway_reroll_ticket_cleanup(uuid, uuid, text)
  to service_role;

revoke all on function public.claim_giveaway_reroll_ticket_cleanup(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_giveaway_reroll_ticket_cleanup(uuid)
  to service_role;

commit;
