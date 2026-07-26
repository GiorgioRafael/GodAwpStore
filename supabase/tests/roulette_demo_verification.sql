begin;

select plan(11);

select has_table('public', 'roulette_demo_inventory');
select has_table('public', 'roulette_demo_spins');
select has_function('public', 'get_demo_roulette_inventory', array[]::text[]);
select has_function('public', 'spin_demo_roulette', array['text']);

select col_is_pk(
  'public',
  'roulette_demo_inventory',
  array['auth_user_id', 'prize_key']
);
select col_is_pk('public', 'roulette_demo_spins', array['id']);

select has_check(
  'public',
  'roulette_demo_inventory',
  'roulette_demo_inventory_prize_key'
);
select has_check(
  'public',
  'roulette_demo_spins',
  'roulette_demo_spins_prize_key'
);

select table_privs_are(
  'public',
  'roulette_demo_inventory',
  'authenticated',
  array['SELECT']
);
select function_privs_are(
  'public',
  'get_demo_roulette_inventory',
  array[]::text[],
  'authenticated',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'spin_demo_roulette',
  array['text'],
  'authenticated',
  array['EXECUTE']
);

select * from finish();

rollback;
