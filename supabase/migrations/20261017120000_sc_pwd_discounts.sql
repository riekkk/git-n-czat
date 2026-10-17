-- Senior Citizen / PWD discounts (non-VAT business: flat 20% off the
-- customer's own portion — the math lives in src/lib/discounts.ts).
--
--   - sales.total keeps meaning "amount charged" (net), so every existing
--     report, the Dashboard and Customers stay correct untouched.
--   - sales.gross_total / discount_total are new and NULL on every existing
--     sale, which reads as "gross = total, no discount".
--   - One sale_discounts row per discounted person, with the required
--     details. The database refuses a row with a blank required field, an
--     unticked "ID verified", mismatched amounts, the same ID twice in one
--     order, a staff order, or a cashier other than the signed-in account.
--   - A discounted sale's total can't be changed afterwards (editing would
--     silently drop the discount) — void it and ring it up again.
--   - Discount rows can't be deleted on their own, and a sale that has them
--     can't be deleted unless it's voided — by any path, the service role
--     included (triggers below; there's no client delete policy either).
--     Deleting a voided sale (delete_voided_sale) removes its discount rows
--     with it (ON DELETE CASCADE), like its sale_items.

-- ─── sales: gross and discount alongside the charged total ─────────────────
alter table public.sales
  add column gross_total numeric(12,2),
  add column discount_total numeric(12,2),
  add constraint sales_discount_total_check check (
    (gross_total is null and discount_total is null)
    or (discount_total >= 0 and gross_total >= discount_total and total = gross_total - discount_total)
  );

-- ─── one row per discounted person ─────────────────────────────────────────
create table public.sale_discounts (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  created_at timestamptz not null default now(),
  cashier text not null default (auth.jwt() ->> 'email'),
  discount_type text not null check (discount_type in ('senior', 'pwd')),
  full_name text not null check (btrim(full_name) <> ''),
  id_type text not null check (id_type in ('osca', 'gov_id', 'pwd_id')),
  id_number text not null check (btrim(id_number) <> ''),
  id_verified boolean not null check (id_verified),
  mode text not null check (mode in ('items', 'shared')),
  -- items: [{ lineId, name, qty, unitPrice, amount }]; shared: { diners, shareOf }
  covered jsonb not null,
  gross numeric(12,2) not null check (gross > 0),
  discount numeric(12,2) not null check (discount >= 0 and discount <= gross),
  net numeric(12,2) not null,
  constraint sale_discounts_net_check check (net = gross - discount),
  -- Senior Citizen: OSCA ID or another valid government ID (passport,
  -- driver's license, UMID…). PWD: PWD ID only.
  constraint sale_discounts_id_matches_type check (
    (discount_type = 'senior' and id_type in ('osca', 'gov_id')) or (discount_type = 'pwd' and id_type = 'pwd_id')
  )
);

-- One discount per person per order ("1234-5678" and "12345678" are the same ID).
create unique index sale_discounts_one_per_person
  on public.sale_discounts (sale_id, id_type, upper(regexp_replace(id_number, '[\s-]', '', 'g')));
create index sale_discounts_created_at_idx on public.sale_discounts (created_at desc);

alter table public.sale_discounts enable row level security;

-- Full staff only (never Inventory Staff or the Customer Display), same as
-- sales. Insert only onto a customer sale, stamped with the signed-in
-- cashier. No update or delete policy: rows are written once at checkout and
-- only leave with their sale.
create policy "Staff can select sale_discounts" on public.sale_discounts
  for select to authenticated
  using (not public.is_inventory_staff() and not public.is_customer_display());

create policy "Staff can insert sale_discounts" on public.sale_discounts
  for insert to authenticated
  with check (
    not public.is_inventory_staff() and not public.is_customer_display()
    and cashier = (auth.jwt() ->> 'email')
    and exists (select 1 from public.sales s where s.id = sale_id and not s.is_staff_order)
  );

-- ─── a discounted sale's amounts are fixed ─────────────────────────────────
-- Voiding (status/voided_at/voided_by) still works; changing the total,
-- gross or discount does not.
create or replace function public.lock_discounted_sale_amounts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.discount_total is not null
     and (new.total is distinct from old.total
          or new.gross_total is distinct from old.gross_total
          or new.discount_total is distinct from old.discount_total) then
    raise exception 'This sale has an SC/PWD discount, so its amounts can''t be edited. Void it and ring it up again.';
  end if;
  return new;
end;
$$;

create trigger sales_lock_discounted_amounts
  before update on public.sales
  for each row execute function public.lock_discounted_sale_amounts();

-- ─── discount records leave only with their voided sale ────────────────────
-- Security definer so RLS can't hide the rows being checked.
create or replace function public.guard_discounted_sale_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from 'voided'
     and exists (select 1 from public.sale_discounts where sale_id = old.id) then
    raise exception 'This sale has SC/PWD discount records and isn''t voided, so it can''t be deleted.';
  end if;
  return old;
end;
$$;

create trigger sales_guard_discounted_delete
  before delete on public.sales
  for each row execute function public.guard_discounted_sale_delete();

-- A discount row may only be deleted by the cascade from deleting its sale
-- (by then the sale row is already gone), never on its own.
create or replace function public.guard_sale_discount_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.sales where id = old.sale_id) then
    raise exception 'SC/PWD discount records can''t be deleted on their own.';
  end if;
  return old;
end;
$$;

create trigger sale_discounts_guard_delete
  before delete on public.sale_discounts
  for each row execute function public.guard_sale_discount_delete();

revoke all on function public.lock_discounted_sale_amounts() from public, anon, authenticated;
revoke all on function public.guard_discounted_sale_delete() from public, anon, authenticated;
revoke all on function public.guard_sale_discount_delete() from public, anon, authenticated;
