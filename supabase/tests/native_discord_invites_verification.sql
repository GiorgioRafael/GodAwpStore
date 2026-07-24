-- Transactional verification for native Discord invite attribution.

begin;

set local client_min_messages = warning;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '81000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'native-invite-admin@example.invalid',
  '',
  now(),
  '{"provider":"discord","providers":["discord"]}'::jsonb,
  '{"sub":"810000000000000001"}'::jsonb,
  now(),
  now()
);

insert into public.admin_profiles (
  auth_user_id, discord_user_id, display_name, is_active, authorization_expires_at
) values (
  '81000000-0000-4000-8000-000000000001',
  '810000000000000001',
  'Native Invite Admin',
  true,
  now() + interval '10 minutes'
);

insert into public.games (id, name, slug, status, created_by) values (
  '82000000-0000-4000-8000-000000000001',
  'Native Invite Game',
  'native-invite-game',
  'active',
  '81000000-0000-4000-8000-000000000001'
);
insert into public.substores (id, game_id, name, slug, title, status, created_by) values (
  '83000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'Native Invite Store',
  'native-invite-store',
  'Native Invite Store',
  'active',
  '81000000-0000-4000-8000-000000000001'
);
insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status, created_by
) values (
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  'Native Invite Prize',
  'native-invite-prize',
  1000,
  5,
  'active',
  '81000000-0000-4000-8000-000000000001'
);
insert into public.guilds (
  id, discord_guild_id, owner_discord_id, name, status
) values (
  '85000000-0000-4000-8000-000000000001',
  '850000000000000001',
  '850000000000000002',
  'Native Invite Guild',
  'active'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select * from public.admin_create_giveaway_v2(
  'nativeinvite01',
  '85000000-0000-4000-8000-000000000001',
  '850000000000000003',
  'sorteios',
  null,
  null,
  'Sorteio com convite nativo',
  '',
  '',
  now() + interval '1 hour',
  1,
  7,
  0,
  jsonb_build_array(jsonb_build_object(
    'product_id', '84000000-0000-4000-8000-000000000001',
    'quantity', 1
  ))
);

do $$
begin
  begin
    perform *
    from public.record_discord_native_invite_join(
      '850000000000000001',
      '860000000000000009',
      'Forged Invitee',
      null,
      now() - interval '30 days',
      now(),
      false,
      'attributed',
      'forged',
      '860000000000000001',
      '{}'::jsonb
    );
    raise exception 'Authenticated user called the native invite worker RPC';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.discord_native_invite_events;
    raise exception 'Authenticated user read native invite events';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select * from public.register_giveaway_participant(
  (select id from public.giveaways where public_slug = 'nativeinvite01'),
  '860000000000000001',
  'Native Inviter',
  null
);

do $$
declare
  v_result record;
begin
  select * into strict v_result
  from public.record_discord_native_invite_join(
    '850000000000000001',
    '860000000000000002',
    'Native Invitee',
    null,
    now() - interval '30 days',
    now(),
    false,
    'attributed',
    'nativeABC',
    '860000000000000001',
    '{"detection_source":"usage_delta"}'::jsonb
  );
  if v_result.event_status <> 'attributed'
    or v_result.affected_giveaway_count <> 1
    or not v_result.was_created then
    raise exception 'Valid native invite was not attributed: %', row_to_json(v_result);
  end if;

  select * into strict v_result
  from public.record_discord_native_invite_join(
    '850000000000000001',
    '860000000000000002',
    'Native Invitee',
    null,
    now() - interval '30 days',
    (select joined_at from public.discord_native_invite_events
      where invitee_discord_user_id = '860000000000000002'),
    false,
    'attributed',
    'nativeABC',
    '860000000000000001',
    '{"detection_source":"retry"}'::jsonb
  );
  if v_result.was_created or v_result.affected_giveaway_count <> 1 then
    raise exception 'Native invite retry was not idempotent';
  end if;
end
$$;

select * from public.record_discord_native_invite_join(
  '850000000000000001',
  '860000000000000003',
  'Too New Invitee',
  null,
  now() - interval '1 day',
  now(),
  false,
  'attributed',
  'nativeDEF',
  '860000000000000001',
  '{}'::jsonb
);

select * from public.record_discord_native_invite_join(
  '850000000000000001',
  '860000000000000004',
  'Ambiguous Invitee',
  null,
  now() - interval '30 days',
  now(),
  false,
  'ambiguous',
  null,
  null,
  '{"reason":"multiple_invites_changed"}'::jsonb
);

select * from public.record_discord_native_invite_join(
  '850000000000000001',
  '860000000000000005',
  'Pending Screening Invitee',
  null,
  now() - interval '30 days',
  now(),
  true,
  'attributed',
  'nativeGHI',
  '860000000000000001',
  '{}'::jsonb
);

reset role;

do $$
begin
  if (
    select valid_invite_count
    from public.giveaway_entries
    where discord_user_id = '860000000000000001'
  ) <> 1 then
    raise exception 'Native invite counter is incorrect';
  end if;
  if (
    select count(*)
    from public.giveaway_referrals
    where attribution_source = 'discord_native'
      and native_invite_code = 'nativeABC'
      and native_inviter_discord_user_id = '860000000000000001'
      and status = 'valid'
  ) <> 1 then
    raise exception 'Valid native referral metadata is incorrect';
  end if;
  if (
    select count(*)
    from public.giveaway_referrals
    where invitee_discord_user_id = '860000000000000003'
      and status = 'invalid'
      and invalid_reason = 'account_too_new'
  ) <> 1 then
    raise exception 'Too-new native invitee was not rejected';
  end if;
  if (
    select count(*)
    from public.giveaway_referrals
    where invitee_discord_user_id = '860000000000000004'
  ) <> 0 then
    raise exception 'Ambiguous native invite created a referral';
  end if;
  if (
    select count(*)
    from public.giveaway_referrals
    where invitee_discord_user_id = '860000000000000005'
      and status = 'pending'
  ) <> 1 then
    raise exception 'Member screening did not keep the native referral pending';
  end if;
end
$$;

rollback;

select 'GodAwpStore native Discord invite verification passed' as result;
