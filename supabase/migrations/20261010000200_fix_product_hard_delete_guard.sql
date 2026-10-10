-- Missing authorization is NULL; it must reject hard deletion just like 'off'.
-- The existing administrator RPC explicitly sets the flag to 'on' after checks.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.reject_product_hard_delete_unless_authorized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.product_hard_delete_authorized', true) is distinct from 'on' then
    raise exception 'immutable_record' using errcode = '55000';
  end if;
  return old;
end
$$;

-- CREATE OR REPLACE preserves the existing function owner and EXECUTE grants.
-- The products trigger and authorized RPCs retain their definitions and grants.
commit;
