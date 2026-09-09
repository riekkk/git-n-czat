-- Cost price per product, used to compute real COGS/net profit/margin in
-- Reports instead of a fabricated number. Defaults to 0 for existing
-- products until their actual cost is entered via Edit Product.
alter table products
  add column if not exists cost_price numeric not null default 0
  check (cost_price >= 0);
