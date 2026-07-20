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

select * from public.admin_create_giveaway(
  'giveawaytest0001',
  '75000000-0000-4000-8000-000000000001',
  '750000000000000003',
  'sorteios',
  null::text,
  null::text,
  'Pacote de integração',
  'Descrição',
  'Regras',
  now() - interval '1 minute',
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

do $$
begin
  if (select stock_quantity from public.products where id = '74000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Giveaway cancellation did not restore stock exactly once';
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

select * from public.register_giveaway_referral(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  (select referral_token from public.giveaway_entries where discord_user_id = '760000000000000001'),
  '760000000000000002',
  'Invitee',
  null,
  now() - interval '30 days',
  true
);

update public.giveaways
set ends_at = now() - interval '1 second'
where public_slug = 'giveawaytest0001';

select * from public.claim_due_giveaway('77000000-0000-4000-8000-000000000001');
select * from public.complete_giveaway_draw(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  '77000000-0000-4000-8000-000000000001',
  (select id from public.giveaway_entries where discord_user_id = '760000000000000001')
);

select * from public.claim_giveaway_ticket('77000000-0000-4000-8000-000000000002');
select public.complete_giveaway_ticket(
  (select id from public.giveaways where public_slug = 'giveawaytest0001'),
  '77000000-0000-4000-8000-000000000002',
  '770000000000000003'
);

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
  ) <> 1 then
    raise exception 'Valid referral count was not maintained';
  end if;
end
$$;

reset role;
rollback;

select 'GodAwpStore giveaway verification passed' as result;
