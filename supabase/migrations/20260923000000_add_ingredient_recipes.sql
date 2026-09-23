-- Ingredient-level inventory deduction: a sellable product can now declare a
-- recipe (which ingredients, and how many servings of each, one unit of the
-- product consumes), and each ingredient has a Yield — how many servings one
-- stock unit produces (e.g. a 1L bottle of Milk yielding 20 lattes' worth).
-- Selling a product then deducts servings / yield_per_unit from each
-- ingredient's own stock, in addition to the product's own stock.

-- Servings/yield math is rarely a whole number, and stock needs to carry
-- that precision now that it can be auto-deducted this way (e.g. 3 lattes at
-- 1 serving of milk each, with Milk's yield at 20 servings/bottle, removes
-- 0.15 bottles). stock_adjustments logs the same values, so it needs to
-- follow.
alter table products alter column stock type numeric using stock::numeric;
alter table stock_adjustments alter column previous_stock type numeric using previous_stock::numeric;
alter table stock_adjustments alter column new_stock type numeric using new_stock::numeric;

alter table products
  add column if not exists yield_per_unit numeric not null default 1
  check (yield_per_unit > 0);

create table if not exists product_recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  ingredient_id uuid not null references products(id) on delete cascade,
  servings numeric not null check (servings > 0),
  unique (product_id, ingredient_id)
);
create index if not exists product_recipes_product_id_idx on product_recipes (product_id);

alter table product_recipes enable row level security;
create policy "Authenticated can select product_recipes" on product_recipes for select to authenticated using (true);
create policy "Authenticated can insert product_recipes" on product_recipes for insert to authenticated with check (true);
create policy "Authenticated can update product_recipes" on product_recipes for update to authenticated using (true) with check (true);
create policy "Authenticated can delete product_recipes" on product_recipes for delete to authenticated using (true);

alter publication supabase_realtime add table product_recipes;
