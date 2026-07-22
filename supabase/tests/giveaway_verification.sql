-- Transactional verification for prize reservation, exact referrals, draw, and winner ticket claims.

begin;

set local client_min_messages = warning;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '71000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'giveaway-admin@example.invalid',
  '',
  now(),
  '{"provider":"discord","providers":["discord"]}'::jsonb,
  '{"sub":"710000000000000001"}'::jsonb,
  now(),
  now()
);

insert into public.admin_profiles (
  auth_user_id, discord_user_id, display_name, is_active, authorization_expires_at
) values (
  '71000000-0000-4000-8000-000000000001',
  '710000000000000001',
  'Giveaway Admin',
  true,
  now() + interval '10 minutes'
);

insert into public.games (id, name, slug, status, created_by) values (
  '72000000-0000-4000-8000-000000000001',
  'Giveaway Game',
  'giveaway-game',
  'active',
  '71000000-0000-4000-8000-000000000001'
);
insert into public.substores (id, game_id, name, slug, title, status, created_by) values (
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'Giveaway Store',
  'giveaway-store',
  'Giveaway Store',
  'active',
  '71000000-0000-4000-8000-000000000001'
);
insert into public.products (
  id, substore_id, name, slug, minimum_price_cents, stock_quantity, status, created_by
) values (
  '74000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  'Giveaway Prize',
  'giveaway-prize',
  1000,
  5,
  'active',
  '71000000-0000-4000-8000-000000000001'
);
insert into public.guilds (
  id, discord_guild_id, owner_discord_id, name, status
) values (
  '75000000-0000-4000-8000-000000000001',
  '750000000000000001',
  '750000000000000002',
  'Giveaway Guild',
  'active'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select * from public.admin_create_giveaway_v2(
  'giveawaytest0001',
  '75000000-0000-4000-8000-000000000001',
  '750000000000000003',
  'sorteios',
  null::text,
  null::text,
  'Pacote de integração',
  'Descrição',
  'Regras',
  now() + interval '1 hour',
  1,
  7,
  0,
  jsonb_build_array(jsonb_build_object(
    'product_id', '74000000-0000-4000-8000-000000000001',
    'quantity', 2
  ))
);

do $$
begin
  if (select stock_quantity from public.products where id = '74000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Giveaway did not reserve aggregate stock';
  end if;
  if (
    select status = 'active'
      and starts_at >= current_timestamp
      and starts_at <= statement_timestamp()
    from public.giveaways
    where public_slug = 'giveawaytest0001'
  ) is not true then
    raise exception 'Giveaway did not start at database creation time';
  end if;
  if (
    select count(*)
    from public.giveaway_prizes
    where giveaway_id = (select id from public.giveaways where public_slug = 'giveawaytest0001')
      and product_name = 'Giveaway Prize'
      and quantity = 2
  ) <> 1 then
    raise exception 'Giveaway prize snapshot is invalid';
  end if;
  if (
    select count(*)
    from public.audit_events
    where action = 'giveaway.create'
      and actor_auth_user_id = '71000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'Giveaway creation was not audited';
  end if;
  begin
    update public.giveaways set title = 'forged' where public_slug = 'giveawaytest0001';
    raise exception 'Authenticated admin bypassed the giveaway RPC';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

select * from public.admin_create_giveaway(
  'giveawaytest0002',
  '75000000-0000-4000-8000-000000000001',
  '750000000000000003',
  'sorteios',
  null::text,
  null::text,
  'Sorteio cancelável',
  '',
  '',
  now() - interval '1 minute',
  now() + interval '1 hour',
  0,
  0,
  0,
  jsonb_build_array(jsonb_build_object(
    'product_id', '74000000-0000-4000-8000-000000000001',
    'quantity', 1
  ))
);
select * from public.admin_cancel_giveaway(
  (select id from public.giveaways where public_slug = 'giveawaytest0002')
);

select * from public.admin_create_giveaway(
  'giveawaytest0003',
  '75000000-0000-4000-8000-000000000001',
  '750000000000000003',
  'sorteios',
  null::text,
  null::text,
  'Sorteio agendado recuperável',
  '',
  '',
  now() + interval '1 hour',
  now() + interval '2 hours',
  0,
  0,
  0,
  jsonb_build_array(jsonb_build_object(
    'product_id', '74000000-0000-4000-8000-000000000001',
    'quantity', 1
  ))
);

do $$
begin
  if (select stock_quantity from public.products where id = '74000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Cancellation or scheduled reservation changed stock incorrectly';
  end if;
end
$$;

reset role;
set local role service_role;

select * from public.register_giveaway_participant(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  '760000000000000001',
  'Participant',
  null
);

do $$
declare
  v_was_created boolean;
begin
  select was_created into strict v_was_created
  from public.register_giveaway_participant(
    (select id from public.giveaways where public_slug = 'giveawaytest0001'),
    '760000000000000001',
    'Participant Updated',
    null
  );
  if v_was_created then
    raise exception 'Repeated giveaway participation was not idempotent';
  end if;
  if (
    select count(*)
    from public.giveaway_entries
    where giveaway_id = (select id from public.giveaways where public_slug = 'giveawaytest0001')
      and discord_user_id = '760000000000000001'
  ) <> 1 then
    raise exception 'Repeated giveaway participation created a duplicate entry';
  end if;
end
$$;

select * from public.register_giveaway_referral(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  (select referral_token from public.giveaway_entries where discord_user_id = '760000000000000001'),
  '760000000000000002',
  'Invitee',
  null,
  now() - interval '30 days',
  true
);

select * from public.register_giveaway_referral(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  (select referral_token from public.giveaway_entries where discord_user_id = '760000000000000001'),
  '760000000000000003',
  'Second Invitee',
  null,
  now() - interval '30 days',
  true
);

select public.set_giveaway_referral_status(
  (select id from public.giveaway_referrals where invitee_discord_user_id = '760000000000000002'),
  'invalid',
  'verification test'
);
select public.set_giveaway_referral_status(
  (select id from public.giveaway_referrals where invitee_discord_user_id = '760000000000000002'),
  'valid',
  null
);

do $$
begin
  if (
    select access_token = referral_token
    from public.giveaway_entries
    where discord_user_id = '760000000000000001'
  ) is not false then
    raise exception 'Participant access token was not separated from the public referral token';
  end if;
  if (
    select valid_invite_count
    from public.giveaway_entries
    where discord_user_id = '760000000000000001'
  ) <> 2 then
    raise exception 'Referral counter was not recomputed after status transitions';
  end if;
end
$$;

reset role;
update public.giveaways
set starts_at = now() - interval '2 seconds',
    ends_at = now() - interval '1 second'
where public_slug = 'giveawaytest0001';
set local role service_role;

select * from public.claim_due_giveaway_v2('77000000-0000-4000-8000-000000000001');
select public.mark_giveaway_entry_membership(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  '77000000-0000-4000-8000-000000000001',
  (select id from public.giveaway_entries where discord_user_id = '760000000000000001'),
  true,
  null
);
select public.mark_giveaway_referral_draw_status(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  '77000000-0000-4000-8000-000000000001',
  (select id from public.giveaway_referrals where invitee_discord_user_id = '760000000000000002'),
  true,
  null
);
select public.mark_giveaway_referral_draw_status(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  '77000000-0000-4000-8000-000000000001',
  (select id from public.giveaway_referrals where invitee_discord_user_id = '760000000000000003'),
  true,
  null
);
do $$
begin
  if (
    select discord_user_id
    from public.pick_giveaway_winner(
      (select id from public.giveaways where public_slug = 'giveawaytest0001'),
      '77000000-0000-4000-8000-000000000001'
    )
  ) <> '760000000000000001' then
    raise exception 'Full-set winner selection did not return the eligible participant';
  end if;
end
$$;
select * from public.complete_giveaway_draw_v2(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  '77000000-0000-4000-8000-000000000001',
  (select id from public.giveaway_entries where discord_user_id = '760000000000000001')
);

reset role;
update public.giveaways
set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour'
where public_slug = 'giveawaytest0003';
set local role service_role;

select * from public.claim_due_giveaway_v2('77000000-0000-4000-8000-000000000004');
select * from public.complete_giveaway_draw_v2(
  (select id from public.giveaways where public_slug = 'giveawaytest0003'),
  '77000000-0000-4000-8000-000000000004',
  null
);

select * from public.claim_giveaway_ticket('77000000-0000-4000-8000-000000000002');
select public.complete_giveaway_ticket(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  '77000000-0000-4000-8000-000000000002',
  '770000000000000003'
);

reset role;
do $$
begin
  if (
    select status = 'completed'
      and winner_discord_user_id = '760000000000000001'
      and discord_ticket_status = 'open'
      and discord_ticket_channel_id = '770000000000000003'
    from public.giveaways
    where public_slug = 'giveawaytest0001'
  ) is not true then
    raise exception 'Giveaway winner or ticket terminal state is invalid';
  end if;
  if (
    select valid_invite_count
    from public.giveaway_entries
    where discord_user_id = '760000000000000001'
  ) <> 2 then
    raise exception 'Valid referral count was not maintained';
  end if;
  if (
    select status = 'failed' and stock_released_at is not null
    from public.giveaways
    where public_slug = 'giveawaytest0003'
  ) is not true then
    raise exception 'Expired scheduled giveaway was not finalized and released';
  end if;
  if (
    select stock_quantity
    from public.products
    where id = '74000000-0000-4000-8000-000000000001'
  ) <> 3 then
    raise exception 'Expired scheduled giveaway did not restore stock exactly once';
  end if;
end
$$;

rollback;

select 'GodAwpStore giveaway verification passed' as result;
