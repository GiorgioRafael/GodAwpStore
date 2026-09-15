begin;
alter table public.eclipsepay_checkouts
  add column fee_cents bigint check (fee_cents >= 0),
  add column net_cents bigint check (net_cents >= 0);
comment on column public.eclipsepay_checkouts.fee_cents is 'Actual provider fee from the reconciled operation; never used as the buyer payment amount.';
comment on column public.eclipsepay_checkouts.net_cents is 'Actual reconciled net receipt, not a percentage estimate.';
commit;
