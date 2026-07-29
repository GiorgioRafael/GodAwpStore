-- The roulette reads the store price; it does not set it.
--
-- 20260728000200 let a prize be repriced from the roulette page, which meant
-- the same catalog price had two editors with different rules and two places to
-- look when it changed. A prize is worth what the store charges for the item,
-- full stop: the wheel pulls that value and the catalog stays the one place it
-- is decided.

begin;

set local lock_timeout = '5s';

drop function if exists public.admin_update_roulette_prize_price(uuid, integer);

commit;
