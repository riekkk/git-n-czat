-- Customer Display: a read-only iPad account (auth app_metadata.role =
-- 'customer_display') that shows the order currently being rung up on the
-- register, and nothing else.
--
-- The register device writes the in-progress order — already reduced to
-- customer-safe fields (no notes, names, costs, stock, staff orders) — into
-- a single live_order row. The display account can read that row and
-- NOTHING else: every other table's policies are tightened below to exclude
-- it, so even a direct API call with its session returns no data.

create or replace function public.is_customer_display()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'customer_display'
$$;

-- ─── The live order ─────────────────────────────────────────────────────────
create table public.live_order (
  id text primary key default 'main',
  payload jsonb not null default '{"phase": "idle"}',
  -- Server time of the register's last write (order change or heartbeat).
  -- Set by trigger, so device clocks never matter.
  heartbeat_at timestamptz not null default now(),
  constraint live_order_single_row check (id = 'main')
);

create or replace function public.touch_live_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.heartbeat_at := now();
  return new;
end;
$$;

create trigger live_order_touch
  before insert or update on public.live_order
  for each row execute function public.touch_live_order();

alter table public.live_order enable row level security;

create policy "Display and staff can read live_order"
  on public.live_order for select to authenticated
  using (not public.is_inventory_staff());
create policy "Staff can insert live_order"
  on public.live_order for insert to authenticated
  with check (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Staff can update live_order"
  on public.live_order for update to authenticated
  using (not public.is_inventory_staff() and not public.is_customer_display())
  with check (not public.is_inventory_staff() and not public.is_customer_display());

-- Age of the live order by the server's own clock, so the display can tell
-- after a reconnect whether what's stored is current (heartbeat within 30s)
-- without trusting the iPad's clock. security_invoker: the view applies the
-- caller's RLS, not the view owner's.
create view public.live_order_status
  with (security_invoker = true) as
  select id, payload, heartbeat_at, extract(epoch from (now() - heartbeat_at))::float as age_seconds
  from public.live_order;

alter publication supabase_realtime add table public.live_order;

insert into public.live_order (id) values ('main');

-- ─── Lock the display account out of everything else ───────────────────────
-- products, product_recipes, stock_adjustments: were open to all signed-in
-- accounts (using true).
drop policy "Authenticated can select products" on products;
drop policy "Authenticated can insert products" on products;
drop policy "Authenticated can update products" on products;
drop policy "Authenticated can delete products" on products;
create policy "Authenticated can select products" on products for select to authenticated using (not public.is_customer_display());
create policy "Authenticated can insert products" on products for insert to authenticated with check (not public.is_customer_display());
create policy "Authenticated can update products" on products for update to authenticated using (not public.is_customer_display()) with check (not public.is_customer_display());
create policy "Authenticated can delete products" on products for delete to authenticated using (not public.is_customer_display());

drop policy "Authenticated can select product_recipes" on product_recipes;
drop policy "Authenticated can insert product_recipes" on product_recipes;
drop policy "Authenticated can update product_recipes" on product_recipes;
drop policy "Authenticated can delete product_recipes" on product_recipes;
create policy "Authenticated can select product_recipes" on product_recipes for select to authenticated using (not public.is_customer_display());
create policy "Authenticated can insert product_recipes" on product_recipes for insert to authenticated with check (not public.is_customer_display());
create policy "Authenticated can update product_recipes" on product_recipes for update to authenticated using (not public.is_customer_display()) with check (not public.is_customer_display());
create policy "Authenticated can delete product_recipes" on product_recipes for delete to authenticated using (not public.is_customer_display());

drop policy "Authenticated can select stock_adjustments" on stock_adjustments;
drop policy "Authenticated can insert stock_adjustments" on stock_adjustments;
drop policy "Authenticated can update stock_adjustments" on stock_adjustments;
drop policy "Authenticated can delete stock_adjustments" on stock_adjustments;
create policy "Authenticated can select stock_adjustments" on stock_adjustments for select to authenticated using (not public.is_customer_display());
create policy "Authenticated can insert stock_adjustments" on stock_adjustments for insert to authenticated with check (not public.is_customer_display());
create policy "Authenticated can update stock_adjustments" on stock_adjustments for update to authenticated using (not public.is_customer_display()) with check (not public.is_customer_display());
create policy "Authenticated can delete stock_adjustments" on stock_adjustments for delete to authenticated using (not public.is_customer_display());

-- sales, sale_items, drawer_openings: already closed to Inventory Staff;
-- now closed to the display too.
drop policy "Authenticated can select sales" on sales;
drop policy "Authenticated can insert sales" on sales;
drop policy "Authenticated can update sales" on sales;
drop policy "Authenticated can delete sales" on sales;
create policy "Authenticated can select sales" on sales for select to authenticated using (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Authenticated can insert sales" on sales for insert to authenticated with check (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Authenticated can update sales" on sales for update to authenticated using (not public.is_inventory_staff() and not public.is_customer_display()) with check (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Authenticated can delete sales" on sales for delete to authenticated using (not public.is_inventory_staff() and not public.is_customer_display());

drop policy "Authenticated can select sale_items" on sale_items;
drop policy "Authenticated can insert sale_items" on sale_items;
drop policy "Authenticated can update sale_items" on sale_items;
drop policy "Authenticated can delete sale_items" on sale_items;
create policy "Authenticated can select sale_items" on sale_items for select to authenticated using (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Authenticated can insert sale_items" on sale_items for insert to authenticated with check (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Authenticated can update sale_items" on sale_items for update to authenticated using (not public.is_inventory_staff() and not public.is_customer_display()) with check (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Authenticated can delete sale_items" on sale_items for delete to authenticated using (not public.is_inventory_staff() and not public.is_customer_display());

drop policy "Authenticated can select drawer_openings" on drawer_openings;
drop policy "Authenticated can insert drawer_openings" on drawer_openings;
create policy "Authenticated can select drawer_openings" on drawer_openings for select to authenticated using (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Authenticated can insert drawer_openings" on drawer_openings for insert to authenticated with check (not public.is_inventory_staff() and not public.is_customer_display());

-- app_settings (print station): readable by all signed-in accounts before;
-- the display doesn't need it.
drop policy "Authenticated can select app_settings" on public.app_settings;
drop policy "Staff can insert app_settings" on public.app_settings;
drop policy "Staff can update app_settings" on public.app_settings;
create policy "Authenticated can select app_settings" on public.app_settings for select to authenticated using (not public.is_customer_display());
create policy "Staff can insert app_settings" on public.app_settings for insert to authenticated with check (not public.is_inventory_staff() and not public.is_customer_display());
create policy "Staff can update app_settings" on public.app_settings for update to authenticated using (not public.is_inventory_staff() and not public.is_customer_display()) with check (not public.is_inventory_staff() and not public.is_customer_display());
