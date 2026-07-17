begin;

-- The aggregate-stock UI no longer uses these legacy encrypted-unit RPCs.
-- Keep them available for authenticated historical maintenance, but remove the
-- explicit anon grants that can be reintroduced by dashboard function settings.
revoke all on function public.admin_import_inventory_units(uuid, text, text, jsonb, uuid)
  from public, anon;
revoke all on function public.admin_get_inventory_secret(uuid)
  from public, anon;
revoke all on function public.admin_check_inventory_fingerprints(text[])
  from public, anon;
revoke all on function public.admin_change_inventory_status(uuid, text, text)
  from public, anon;

grant execute on function public.admin_import_inventory_units(uuid, text, text, jsonb, uuid)
  to authenticated, service_role;
grant execute on function public.admin_get_inventory_secret(uuid)
  to authenticated, service_role;
grant execute on function public.admin_check_inventory_fingerprints(text[])
  to authenticated, service_role;
grant execute on function public.admin_change_inventory_status(uuid, text, text)
  to authenticated, service_role;

commit;
