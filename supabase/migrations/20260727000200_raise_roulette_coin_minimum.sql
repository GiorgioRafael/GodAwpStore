-- Raise the roulette coin purchase floor to five coins.
-- LivePix charges a percentage per Pix receipt with no fixed component, so a
-- small ticket is not penalised by itself. The floor exists to keep the coin
-- purchase above the store average order and to cut the number of one-real
-- charges the operator has to reconcile.

begin;

set local lock_timeout = '5s';

alter table public.roulette_coin_purchases
  drop constraint if exists roulette_coin_purchases_amount_range;

-- Nothing to backfill: purchases below the new floor never reached production.
alter table public.roulette_coin_purchases
  add constraint roulette_coin_purchases_amount_range
  check (amount_cents between 500 and 10000 and amount_cents % 100 = 0);

create or replace function public.start_roulette_coin_purchase(
  p_discord_user_id text,
  p_coin_quantity integer
)
returns table (
  purchase_id uuid,
  purchase_status text,
  purchase_checkout_url text,
  purchase_amount_cents integer,
  purchase_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_purchase public.roulette_coin_purchases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_amount_cents integer;
begin
  if v_auth_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception using
      errcode = '22023',
      message = 'Discord user ID is invalid.';
  end if;
  if p_coin_quantity is null or p_coin_quantity < 5 or p_coin_quantity > 100 then
    raise exception using
      errcode = '22023',
      message = 'Coin quantity must be between 5 and 100.';
  end if;
  v_amount_cents := p_coin_quantity * 100;

  -- Serialize per account so a double click cannot open two LivePix charges.
  perform pg_advisory_xact_lock(hashtext('roulette_coin_purchase:' || v_auth_user_id::text));

  update public.roulette_coin_purchases as purchase
  set status = 'expired'
  where purchase.auth_user_id = v_auth_user_id
    and purchase.status = 'awaiting_payment'
    and purchase.expires_at <= v_now;

  -- An open charge for the same amount is reused so a retry does not stack
  -- unpaid Pix codes on the player.
  select purchase.*
  into v_purchase
  from public.roulette_coin_purchases as purchase
  where purchase.auth_user_id = v_auth_user_id
    and purchase.status = 'awaiting_payment'
    and purchase.amount_cents = v_amount_cents
    and purchase.expires_at > v_now
  order by purchase.created_at desc
  limit 1;

  if not found then
    insert into public.roulette_coin_purchases (
      auth_user_id,
      discord_user_id,
      amount_cents,
      expires_at,
      created_at,
      updated_at
    )
    values (
      v_auth_user_id,
      p_discord_user_id,
      v_amount_cents,
      v_now + interval '30 minutes',
      v_now,
      v_now
    )
    returning * into v_purchase;
  end if;

  return query
  select
    v_purchase.id,
    v_purchase.status,
    v_purchase.payment_checkout_url,
    v_purchase.amount_cents,
    v_purchase.expires_at;
end;
$$;

comment on function public.start_roulette_coin_purchase(text, integer) is
  'Opens or reuses the LivePix charge that buys 5 to 100 roulette coins at R$ 1,00 each.';

commit;
