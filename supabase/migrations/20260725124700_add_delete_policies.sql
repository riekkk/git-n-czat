-- The delete-product feature (added after the original schema) needs a
-- DELETE policy on products, which was never added — RLS was silently
-- blocking every delete (no error, zero rows affected). Also add DELETE on
-- stock_adjustments since it's a cascade-delete target when a product goes
-- away. sale_items doesn't need one: the FK there is ON DELETE SET NULL,
-- which is an UPDATE against sale_items, already covered by its existing
-- update policy.

create policy "Authenticated can delete products"
  on products for delete
  to authenticated
  using (true);

create policy "Authenticated can delete stock_adjustments"
  on stock_adjustments for delete
  to authenticated
  using (true);
