-- Replace the deprecated auth.role() = 'authenticated' pattern with the
-- current-recommended `to authenticated` role targeting. This is faster
-- (no per-row function re-evaluation) and avoids the auth.role() footgun
-- where anonymous-sign-in sessions also carry the 'authenticated' Postgres
-- role and would silently pass the old check.

-- products
drop policy if exists "Authenticated can select products" on products;
drop policy if exists "Authenticated can insert products" on products;
drop policy if exists "Authenticated can update products" on products;
create policy "Authenticated can select products" on products for select to authenticated using (true);
create policy "Authenticated can insert products" on products for insert to authenticated with check (true);
create policy "Authenticated can update products" on products for update to authenticated using (true) with check (true);

-- sales
drop policy if exists "Authenticated can select sales" on sales;
drop policy if exists "Authenticated can insert sales" on sales;
drop policy if exists "Authenticated can update sales" on sales;
create policy "Authenticated can select sales" on sales for select to authenticated using (true);
create policy "Authenticated can insert sales" on sales for insert to authenticated with check (true);
create policy "Authenticated can update sales" on sales for update to authenticated using (true) with check (true);

-- sale_items
drop policy if exists "Authenticated can select sale_items" on sale_items;
drop policy if exists "Authenticated can insert sale_items" on sale_items;
drop policy if exists "Authenticated can update sale_items" on sale_items;
create policy "Authenticated can select sale_items" on sale_items for select to authenticated using (true);
create policy "Authenticated can insert sale_items" on sale_items for insert to authenticated with check (true);
create policy "Authenticated can update sale_items" on sale_items for update to authenticated using (true) with check (true);

-- stock_adjustments
drop policy if exists "Authenticated can select stock_adjustments" on stock_adjustments;
drop policy if exists "Authenticated can insert stock_adjustments" on stock_adjustments;
drop policy if exists "Authenticated can update stock_adjustments" on stock_adjustments;
create policy "Authenticated can select stock_adjustments" on stock_adjustments for select to authenticated using (true);
create policy "Authenticated can insert stock_adjustments" on stock_adjustments for insert to authenticated with check (true);
create policy "Authenticated can update stock_adjustments" on stock_adjustments for update to authenticated using (true) with check (true);
