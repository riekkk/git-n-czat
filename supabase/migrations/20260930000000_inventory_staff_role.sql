-- "Inventory Staff" role: an account whose auth app_metadata.role is
-- 'inventory_staff' may only work with Inventory (products, recipes, stock
-- adjustments). Hiding the other screens in the UI isn't enough on its own —
-- the anon key + that account's session could still query the API directly —
-- so sales/sale_items/drawer_openings are closed to that role here.
--
-- app_metadata (unlike user_metadata) can only be written with the service
-- role, so a signed-in user can't grant themselves a different role. Accounts
-- with no role set (every account that existed before this) are unaffected.

create or replace function public.is_inventory_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'inventory_staff'
$$;

-- sales
drop policy "Authenticated can select sales" on sales;
drop policy "Authenticated can insert sales" on sales;
drop policy "Authenticated can update sales" on sales;
drop policy "Authenticated can delete sales" on sales;
create policy "Authenticated can select sales" on sales for select to authenticated using (not public.is_inventory_staff());
create policy "Authenticated can insert sales" on sales for insert to authenticated with check (not public.is_inventory_staff());
create policy "Authenticated can update sales" on sales for update to authenticated using (not public.is_inventory_staff()) with check (not public.is_inventory_staff());
create policy "Authenticated can delete sales" on sales for delete to authenticated using (not public.is_inventory_staff());

-- sale_items
drop policy "Authenticated can select sale_items" on sale_items;
drop policy "Authenticated can insert sale_items" on sale_items;
drop policy "Authenticated can update sale_items" on sale_items;
drop policy "Authenticated can delete sale_items" on sale_items;
create policy "Authenticated can select sale_items" on sale_items for select to authenticated using (not public.is_inventory_staff());
create policy "Authenticated can insert sale_items" on sale_items for insert to authenticated with check (not public.is_inventory_staff());
create policy "Authenticated can update sale_items" on sale_items for update to authenticated using (not public.is_inventory_staff()) with check (not public.is_inventory_staff());
create policy "Authenticated can delete sale_items" on sale_items for delete to authenticated using (not public.is_inventory_staff());

-- drawer_openings
drop policy "Authenticated can select drawer_openings" on drawer_openings;
drop policy "Authenticated can insert drawer_openings" on drawer_openings;
create policy "Authenticated can select drawer_openings" on drawer_openings for select to authenticated using (not public.is_inventory_staff());
create policy "Authenticated can insert drawer_openings" on drawer_openings for insert to authenticated with check (not public.is_inventory_staff());
