-- sale_discounts was created with Supabase's default table grants (every
-- privilege for anon and authenticated, TRUNCATE included). RLS already
-- limits rows to full staff, but TRUNCATE ignores RLS and row triggers, so
-- grant only what the app uses: authenticated may SELECT and INSERT; anon
-- gets nothing. Not reachable through the API today — defence in depth.
revoke all on public.sale_discounts from anon;
revoke update, delete, truncate, references, trigger on public.sale_discounts from authenticated;
