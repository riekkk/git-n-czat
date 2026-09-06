-- Enable Supabase Realtime so staff sessions stay in sync live: a sale rung
-- up or a stock edit made on one device shows up on everyone else's screen
-- without a manual refresh.
alter publication supabase_realtime add table products, sales, sale_items, stock_adjustments;
