-- Shared app settings, starting with the active Print Station: which
-- PrintNode printer every device sends receipts, reprints, staff-order
-- slips and drawer kicks to. Stored here (not in code or env vars) so
-- switching stations takes effect on every device immediately, with no
-- redeploy — the app reads it before each print job and listens for
-- changes over realtime.

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.app_settings enable row level security;

-- Every signed-in account can read settings (printing needs the station).
create policy "Authenticated can select app_settings"
  on public.app_settings for select to authenticated using (true);

-- Only full staff can change them — not Inventory Staff (see
-- public.is_inventory_staff, from the inventory_staff_role migration).
create policy "Staff can insert app_settings"
  on public.app_settings for insert to authenticated with check (not public.is_inventory_staff());
create policy "Staff can update app_settings"
  on public.app_settings for update to authenticated
  using (not public.is_inventory_staff()) with check (not public.is_inventory_staff());

alter publication supabase_realtime add table public.app_settings;

-- Active station: the MacBook.
insert into public.app_settings (key, value, updated_by)
values ('print_station', '{"printerId": 75810640, "label": "MacBook"}', 'migration');
