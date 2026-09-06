-- Dimpz Cafe POS — initial schema
-- Tables: products, sales, sale_items, stock_adjustments
-- All tables are RLS-protected: only authenticated staff (auth.role() = 'authenticated')
-- may select/insert/update. There is no anonymous access and no delete policy.

create extension if not exists pgcrypto;

-- ── products ────────────────────────────────────────────────────────────────
-- Note: this table also stores raw ingredients (Inventory > "Add Product/Ingredient"
-- > Raw Ingredient), which the app UI has always supported alongside sellable
-- products. `kind` and `unit` are additions beyond the originally-specified 8
-- columns so that flow keeps working against this schema — see the readme note
-- in the app's setup reminder. `emoji` is kept as the historical column name;
-- the app now stores an uploaded product photo (base64 data URL) there instead
-- of a literal emoji character.
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null default 0,
  category text not null default 'Uncategorized',
  stock integer not null default 0,
  emoji text,
  description text,
  kind text not null default 'product' check (kind in ('product', 'ingredient')),
  unit text,
  created_at timestamptz not null default now()
);

-- ── sales ───────────────────────────────────────────────────────────────────
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  total numeric not null default 0,
  payment_method text not null default 'card',
  created_at timestamptz not null default now()
);

-- ── sale_items ──────────────────────────────────────────────────────────────
create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  quantity integer not null,
  unit_price numeric not null
);

-- ── stock_adjustments ───────────────────────────────────────────────────────
create table if not exists stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  previous_stock integer not null,
  new_stock integer not null,
  created_at timestamptz not null default now()
);

-- ── indexes for reporting queries ───────────────────────────────────────────
create index if not exists sales_created_at_idx on sales (created_at desc);
create index if not exists sale_items_sale_id_idx on sale_items (sale_id);
create index if not exists sale_items_product_id_idx on sale_items (product_id);
create index if not exists stock_adjustments_product_id_idx on stock_adjustments (product_id);

-- ── row level security ──────────────────────────────────────────────────────
alter table products enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table stock_adjustments enable row level security;

-- products
create policy "Authenticated can select products"
  on products for select
  using (auth.role() = 'authenticated');

create policy "Authenticated can insert products"
  on products for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update products"
  on products for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- sales
create policy "Authenticated can select sales"
  on sales for select
  using (auth.role() = 'authenticated');

create policy "Authenticated can insert sales"
  on sales for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update sales"
  on sales for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- sale_items
create policy "Authenticated can select sale_items"
  on sale_items for select
  using (auth.role() = 'authenticated');

create policy "Authenticated can insert sale_items"
  on sale_items for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update sale_items"
  on sale_items for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- stock_adjustments
create policy "Authenticated can select stock_adjustments"
  on stock_adjustments for select
  using (auth.role() = 'authenticated');

create policy "Authenticated can insert stock_adjustments"
  on stock_adjustments for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update stock_adjustments"
  on stock_adjustments for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
