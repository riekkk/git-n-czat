-- Permanently deleting VOIDED sales (Reports → tap a voided order 5 times),
-- gated by a separate DELETE PASSWORD that is checked here, in the database,
-- so it can't be read or skipped from the browser.
--
--   - Only status = 'voided' sales; never completed sales or staff orders.
--   - Only full staff — never Inventory Staff or the Customer Display.
--   - The sale's lines go with it (sale_items.sale_id is ON DELETE CASCADE).
--   - Stock is not touched (the void already restored it).
--   - Nothing about a deleted sale is kept anywhere.
--
-- The delete password is stored only as a salted bcrypt hash, in a schema
-- the API doesn't expose and no client role can read. After 5 wrong
-- attempts the delete is locked for 5 minutes. The password itself is set
-- outside this file (never committed), and can be changed in Settings.
--
-- Direct deletes of sales from the browser are removed entirely: the only
-- way to delete a sale is delete_voided_sale() below. (This retires the old
-- Reports → "Clear (N)" bulk delete, which is removed from the app.)

create extension if not exists pgcrypto with schema extensions;

-- ─── Private storage ────────────────────────────────────────────────────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.delete_password (
  id boolean primary key default true check (id),   -- exactly one row
  password_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.delete_password enable row level security;
revoke all on private.delete_password from public, anon, authenticated;

-- 'ok' | 'wrong' | 'locked' | 'not_set'. Counts wrong attempts and locks for
-- 5 minutes after the 5th. Callable only from the functions below (owner).
create or replace function private.check_delete_password(p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.delete_password%rowtype;
begin
  select * into r from private.delete_password where id for update;
  if not found then
    return 'not_set';
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return 'locked';
  end if;
  if p_password is not null and extensions.crypt(p_password, r.password_hash) = r.password_hash then
    update private.delete_password set failed_attempts = 0, locked_until = null where id;
    return 'ok';
  end if;
  if r.failed_attempts + 1 >= 5 then
    update private.delete_password set failed_attempts = 0, locked_until = now() + interval '5 minutes' where id;
    return 'locked';
  end if;
  update private.delete_password set failed_attempts = r.failed_attempts + 1 where id;
  return 'wrong';
end;
$$;
revoke all on function private.check_delete_password(text) from public, anon, authenticated;

-- Shared wording for password outcomes.
create or replace function private.delete_password_error(p_result text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_result
    when 'wrong' then 'Wrong delete password.'
    when 'locked' then 'Too many wrong attempts. Deleting is locked for a few minutes.'
    when 'not_set' then 'No delete password is set yet. Set one in Settings → Delete password.'
    else 'The delete password could not be checked.'
  end
$$;
revoke all on function private.delete_password_error(text) from public, anon, authenticated;

-- ─── No direct deletes of sales ─────────────────────────────────────────────
drop policy "Authenticated can delete sales" on public.sales;

-- ─── Delete one voided sale ─────────────────────────────────────────────────
-- Returns {"ok": true} or {"ok": false, "error": "..."}. Wrong passwords are
-- returned (not raised) so the attempt counter isn't rolled back.
create or replace function public.delete_voided_sale(p_sale_id uuid, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sales%rowtype;
  check_result text;
  deleted int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if public.is_inventory_staff() or public.is_customer_display() then
    return jsonb_build_object('ok', false, 'error', 'This account cannot delete sales.');
  end if;

  select * into s from public.sales where id = p_sale_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Sale not found — it may already have been deleted.');
  end if;
  if s.status is distinct from 'voided' then
    return jsonb_build_object('ok', false, 'error', 'Only voided sales can be deleted.');
  end if;
  if s.is_staff_order then
    return jsonb_build_object('ok', false, 'error', 'Staff orders cannot be deleted.');
  end if;

  check_result := private.check_delete_password(p_password);
  if check_result <> 'ok' then
    return jsonb_build_object('ok', false, 'error', private.delete_password_error(check_result), 'locked', check_result = 'locked');
  end if;

  delete from public.sales where id = p_sale_id and status = 'voided' and not is_staff_order;
  get diagnostics deleted = row_count;
  if deleted = 0 then
    return jsonb_build_object('ok', false, 'error', 'The sale was not deleted.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.delete_voided_sale(uuid, text) from public, anon;
grant execute on function public.delete_voided_sale(uuid, text) to authenticated;

-- ─── Settings: is it set / change it ────────────────────────────────────────
create or replace function public.delete_password_is_set()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_inventory_staff() or public.is_customer_display() then
    return false;
  end if;
  return exists (select 1 from private.delete_password);
end;
$$;
revoke all on function public.delete_password_is_set() from public, anon;
grant execute on function public.delete_password_is_set() to authenticated;

-- Changing requires the current delete password (same lockout). Setting it
-- for the first time (no password yet) needs only a full-staff session; the
-- app also re-checks the account password before calling this.
create or replace function public.set_delete_password(p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_result text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if public.is_inventory_staff() or public.is_customer_display() then
    return jsonb_build_object('ok', false, 'error', 'This account cannot change the delete password.');
  end if;
  if p_new is null or length(p_new) < 6 then
    return jsonb_build_object('ok', false, 'error', 'The new delete password must be at least 6 characters.');
  end if;

  if exists (select 1 from private.delete_password) then
    check_result := private.check_delete_password(p_current);
    if check_result <> 'ok' then
      return jsonb_build_object('ok', false, 'error', private.delete_password_error(check_result), 'locked', check_result = 'locked');
    end if;
    update private.delete_password
      set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), failed_attempts = 0, locked_until = null, updated_at = now()
      where id;
  else
    insert into private.delete_password (password_hash) values (extensions.crypt(p_new, extensions.gen_salt('bf', 10)));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_delete_password(text, text) from public, anon;
grant execute on function public.set_delete_password(text, text) to authenticated;
