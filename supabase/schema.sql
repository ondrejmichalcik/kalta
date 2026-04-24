-- ============================================================================
-- Kalta – Supabase schema (idempotentní, source of truth)
-- Spusť celé v Supabase SQL Editoru. Lze spustit opakovaně bez errorů.
-- Obsahuje: tables, indexes, triggers, RLS policies, RPC funkce, realtime
-- publication, storage bucket.
-- ============================================================================

-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================================
-- TABLES
-- ============================================================================

-- users – mirror auth.users
create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

-- warehouses
create table if not exists public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- warehouse_members (join)
create table if not exists public.warehouse_members (
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (warehouse_id, user_id)
);

create index if not exists idx_warehouse_members_user on public.warehouse_members(user_id);

-- invitations
-- email nullable: share-by-link flow doesn't require knowing recipient address.
-- role: 'member' (default) or 'owner' (co-owner invite).
create table if not exists public.invitations (
  id            uuid primary key default gen_random_uuid(),
  warehouse_id  uuid not null references public.warehouses(id) on delete cascade,
  invited_by    uuid not null references public.users(id) on delete cascade,
  email         text,
  token         uuid not null unique default gen_random_uuid(),
  role          text not null default 'member' check (role in ('member', 'owner')),
  expires_at    timestamptz not null default (now() + interval '7 days'),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_invitations_token on public.invitations(token);
create index if not exists idx_invitations_warehouse on public.invitations(warehouse_id);

-- boxes
create table if not exists public.boxes (
  id              uuid primary key default gen_random_uuid(),
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  name            text not null,
  location        text,
  qr_code         text not null unique default gen_random_uuid()::text,
  nearest_expiry  date,
  item_count      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_boxes_warehouse on public.boxes(warehouse_id);
create index if not exists idx_boxes_qr on public.boxes(qr_code);

-- items
-- opened: once a package is started (pill strip popped, can opened), flag
-- it true so the client sorts it to the top of its expiry group — "use it
-- up first" signal.
-- pack_count: optional "N pieces per package" hint rendered as "Ibuprofen
-- (24 pcs)" in list UIs. Pure display — no math, no prefill.
create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  box_id       uuid not null references public.boxes(id) on delete cascade,
  name         text not null,
  quantity     numeric not null default 1,
  unit         text not null default 'pcs' check (unit in ('pcs','g','kg','ml','l','pack')),
  expiry_date  date,
  barcode      text,
  image_url    text,
  category     text check (category in ('food','medicine','water','disinfectant','equipment','energy','documents','other')),
  notes        text,
  opened       boolean not null default false,
  damaged      boolean not null default false,
  pack_count   int,
  last_verified timestamptz,
  added_by     uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_items_box on public.items(box_id);
create index if not exists idx_items_expiry on public.items(expiry_date);

-- inventory_sessions — one row per inventory check on a box
create table if not exists public.inventory_sessions (
  id              uuid primary key default gen_random_uuid(),
  box_id          uuid not null references public.boxes(id) on delete cascade,
  performed_by    uuid not null references public.users(id) on delete set null,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  found_count     int not null default 0,
  missing_count   int not null default 0,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_inventory_sessions_box on public.inventory_sessions(box_id);

-- inventory_lines — snapshot of each item's status during an inventory session
-- item_name/quantity/unit are snapshots (item might change or be deleted later)
create table if not exists public.inventory_lines (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.inventory_sessions(id) on delete cascade,
  item_id         uuid references public.items(id) on delete set null,
  item_name       text not null,
  item_quantity   numeric not null,
  item_unit       text not null,
  found_quantity  numeric not null default 0,
  status          text not null check (status in ('found', 'missing', 'partial')),
  scanned_barcode text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_inventory_lines_session on public.inventory_lines(session_id);

-- custom_products – lokální DB pro každý sklad
create table if not exists public.custom_products (
  id                  uuid primary key default gen_random_uuid(),
  warehouse_id        uuid not null references public.warehouses(id) on delete cascade,
  barcode             text not null,
  name                text not null,
  category            text,
  image_url           text,
  typical_expiry_days int,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (warehouse_id, barcode)
);

create index if not exists idx_custom_products_warehouse on public.custom_products(warehouse_id);

-- ============================================================================
-- MIGRATIONS (idempotent ALTERs for existing DBs)
-- ============================================================================
-- These bring an already-populated DB up to the current CREATE TABLE defs
-- above. `create table if not exists` skips existing tables, so column /
-- constraint changes must be applied via explicit ALTERs.

-- invitations.email: make nullable (share-by-link doesn't need recipient email)
alter table public.invitations alter column email drop not null;

-- invitations.role: relax check to allow 'owner' (co-owner invite — Sprint 2.7)
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations
  add constraint invitations_role_check check (role in ('member', 'owner'));

-- items.opened — "use this first" flag (Sprint 2.7).
-- items.pack_count — optional "N pieces per package" display hint.
-- Drops the earlier Sprint 2.7 pack_size / pack_unit experiment that never
-- shipped.
alter table public.items drop column if exists pack_size;
alter table public.items drop column if exists pack_unit;
alter table public.custom_products drop column if exists pack_size;
alter table public.custom_products drop column if exists pack_unit;
alter table public.items add column if not exists opened boolean not null default false;
alter table public.items add column if not exists damaged boolean not null default false;
alter table public.items add column if not exists pack_count int;
alter table public.items add column if not exists last_verified timestamptz;

-- inventory_lines: add found_quantity + relax status check for 'partial' (Sprint 3 inventory rewrite)
alter table public.inventory_lines add column if not exists found_quantity numeric not null default 0;
alter table public.inventory_lines drop constraint if exists inventory_lines_status_check;
alter table public.inventory_lines add constraint inventory_lines_status_check check (status in ('found', 'missing', 'partial'));

-- ============================================================================
-- FUNCTIONS + TRIGGERS
-- ============================================================================

-- Automaticky vytvoř public.users záznam po registraci v auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Přepočet nearest_expiry a item_count na boxu po změně items.
-- When an item moves between boxes (box_id changes), BOTH the source and
-- target box must be recalculated — otherwise the source keeps stale
-- item_count / nearest_expiry and the Boxes list shows wrong numbers.
create or replace function public.recalc_box_cache()
returns trigger
language plpgsql
as $$
declare
  target_box uuid;
begin
  target_box := coalesce(new.box_id, old.box_id);
  update public.boxes
  set
    item_count = (
      select count(*) from public.items where box_id = target_box
    ),
    nearest_expiry = (
      select min(expiry_date) from public.items
      where box_id = target_box and expiry_date is not null
    ),
    updated_at = now()
  where id = target_box;

  -- When item moved between boxes, also recalculate the source box.
  if TG_OP = 'UPDATE' and old.box_id is distinct from new.box_id then
    update public.boxes
    set
      item_count = (
        select count(*) from public.items where box_id = old.box_id
      ),
      nearest_expiry = (
        select min(expiry_date) from public.items
        where box_id = old.box_id and expiry_date is not null
      ),
      updated_at = now()
    where id = old.box_id;
  end if;

  return null;
end;
$$;

drop trigger if exists items_recalc_box on public.items;
create trigger items_recalc_box
  after insert or update or delete on public.items
  for each row execute function public.recalc_box_cache();

-- updated_at bump na items při UPDATE
create or replace function public.bump_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists items_bump_updated_at on public.items;
create trigger items_bump_updated_at
  before update on public.items
  for each row execute function public.bump_updated_at();

-- Invariant: a warehouse must always have >=1 member with role='owner'.
-- AFTER trigger on DELETE/UPDATE of warehouse_members. The `exists` guard
-- skips the check when the warehouse itself has been deleted (CASCADE from
-- warehouses delete takes care of cleaning up members).
create or replace function public.enforce_at_least_one_owner()
returns trigger
language plpgsql
as $$
declare
  target_wh uuid;
  owner_count int;
begin
  target_wh := coalesce(new.warehouse_id, old.warehouse_id);

  -- Warehouse already gone (cascade delete) → nothing to enforce.
  if not exists (select 1 from public.warehouses where id = target_wh) then
    return coalesce(new, old);
  end if;

  select count(*) into owner_count
  from public.warehouse_members
  where warehouse_id = target_wh and role = 'owner';

  if owner_count = 0 then
    raise exception 'Warehouse % must have at least one owner', target_wh
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists warehouse_members_one_owner on public.warehouse_members;
create trigger warehouse_members_one_owner
  after delete or update on public.warehouse_members
  for each row execute function public.enforce_at_least_one_owner();

-- ============================================================================
-- RLS HELPER FUNCTIONS
-- ============================================================================

-- Helper: je uživatel member skladu?
create or replace function public.is_member(wh uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.warehouse_members
    where warehouse_id = wh and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(wh uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.warehouse_members
    where warehouse_id = wh and user_id = auth.uid() and role = 'owner'
  );
$$;

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- create_warehouse_for_me
-- Řeší chicken-and-egg RLS problém:
-- Přímé klient INSERT do `warehouses` s `.insert().select()` selže, protože
-- SELECT RLS policy (`is_member(id)`) na RETURNING požaduje, aby user byl
-- member — ale member se stává až dalším insertem do warehouse_members.
-- Tato SECURITY DEFINER funkce bypassne RLS a udělá oba inserty atomicky.
create or replace function public.create_warehouse_for_me(wh_name text)
returns public.warehouses
language plpgsql
security definer
set search_path = public
as $$
declare
  new_wh public.warehouses;
  current_uid uuid;
begin
  current_uid := auth.uid();
  if current_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Zajisti, že public.users záznam existuje (kdyby handle_new_user trigger
  -- nezběhl nebo user byl vytvořen adminem mimo auth flow)
  insert into public.users (id, email, display_name)
  select current_uid, au.email, coalesce(au.raw_user_meta_data->>'full_name', au.email)
  from auth.users au where au.id = current_uid
  on conflict (id) do nothing;

  -- Vytvoř warehouse
  insert into public.warehouses (owner_id, name)
  values (current_uid, wh_name)
  returning * into new_wh;

  -- Přidej ownera jako member
  insert into public.warehouse_members (warehouse_id, user_id, role)
  values (new_wh.id, current_uid, 'owner');

  return new_wh;
end;
$$;

grant execute on function public.create_warehouse_for_me(text) to authenticated;

-- accept_invitation
-- Redeems an invitation token and joins the caller to the warehouse.
-- Needed because `invitations_select` RLS requires membership, which
-- creates a chicken-and-egg: the invitee cannot SELECT the invitation
-- row until they are already a member. SECURITY DEFINER bypasses RLS
-- and performs validation + membership insert + token consumption
-- atomically. Idempotent on the membership insert.
create or replace function public.accept_invitation(invite_token uuid)
returns public.warehouses
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  wh public.warehouses;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into inv from public.invitations where token = invite_token;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invitation has already been used.';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired.';
  end if;

  insert into public.warehouse_members (warehouse_id, user_id, role)
  values (inv.warehouse_id, uid, coalesce(inv.role, 'member'))
  on conflict (warehouse_id, user_id) do nothing;

  update public.invitations set accepted_at = now() where id = inv.id;

  select * into wh from public.warehouses where id = inv.warehouse_id;
  return wh;
end;
$$;

grant execute on function public.accept_invitation(uuid) to authenticated;

-- open_one_item
-- Splits a sealed item into "sealed minus one" + one unit on the opened
-- sibling in the same box. Merges into an existing opened sibling when
-- one matches exactly (strict match on product identity + expiry) instead
-- of creating a duplicate opened row. Atomic via SECURITY DEFINER — RLS
-- is bypassed, so membership is checked explicitly.
-- Guardrails:
--   - source must exist, not be opened, have quantity >= 1
--   - unit must be 'pcs' or 'pack' (continuous units split is meaningless)
--   - caller must be a member of the warehouse owning source.box
-- Behaviour:
--   - source.quantity > 1 → decrement; source.quantity <= 1 → delete
--   - matching opened sibling found → quantity += 1
--   - no sibling → insert new opened row copying all product fields
create or replace function public.open_one_item(source_id uuid)
returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  src public.items;
  wh_id uuid;
  existing_id uuid;
  result public.items;
begin
  select * into src from public.items where id = source_id;
  if not found then
    raise exception 'Item not found';
  end if;

  select warehouse_id into wh_id from public.boxes where id = src.box_id;
  if not public.is_member(wh_id) then
    raise exception 'Not a member of this warehouse';
  end if;

  if src.opened then
    raise exception 'Item is already opened';
  end if;
  if src.unit not in ('pcs', 'pack') then
    raise exception 'Open action only applies to pcs/pack units';
  end if;
  if src.quantity <= 0 then
    raise exception 'Item has zero quantity';
  end if;

  -- Strict product match: same box, same identity, same expiry. Nulls
  -- compared equal via coalesce so NULL == NULL and NULL != 'value'.
  select id into existing_id
  from public.items
  where box_id = src.box_id
    and opened = true
    and name = src.name
    and coalesce(barcode, '')               = coalesce(src.barcode, '')
    and coalesce(expiry_date, '1900-01-01') = coalesce(src.expiry_date, '1900-01-01')
    and coalesce(category, '')              = coalesce(src.category, '')
    and unit = src.unit
    and coalesce(pack_count, 0)             = coalesce(src.pack_count, 0)
  limit 1;

  if src.quantity <= 1 then
    delete from public.items where id = src.id;
  else
    update public.items set quantity = quantity - 1 where id = src.id;
  end if;

  if existing_id is not null then
    update public.items
    set quantity = quantity + 1
    where id = existing_id
    returning * into result;
  else
    insert into public.items (
      box_id, name, quantity, unit, expiry_date, barcode, image_url,
      category, notes, opened, pack_count, added_by
    ) values (
      src.box_id, src.name, 1, src.unit, src.expiry_date, src.barcode,
      src.image_url, src.category, src.notes, true, src.pack_count, auth.uid()
    )
    returning * into result;
  end if;

  return result;
end;
$$;

grant execute on function public.open_one_item(uuid) to authenticated;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

alter table public.users enable row level security;
alter table public.warehouses enable row level security;
alter table public.warehouse_members enable row level security;
alter table public.invitations enable row level security;
alter table public.boxes enable row level security;
alter table public.items enable row level security;
alter table public.custom_products enable row level security;
alter table public.inventory_sessions enable row level security;
alter table public.inventory_lines enable row level security;

-- users: každý vidí sám sebe a členy svých skladů
drop policy if exists users_self on public.users;
create policy users_self on public.users for select
  using (id = auth.uid() or id in (
    select user_id from public.warehouse_members
    where warehouse_id in (
      select warehouse_id from public.warehouse_members where user_id = auth.uid()
    )
  ));

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users for update
  using (id = auth.uid()) with check (id = auth.uid());

-- warehouses: jen členové
drop policy if exists warehouses_select on public.warehouses;
create policy warehouses_select on public.warehouses for select
  using (public.is_member(id));

drop policy if exists warehouses_insert on public.warehouses;
create policy warehouses_insert on public.warehouses for insert
  with check (owner_id = auth.uid());

drop policy if exists warehouses_update on public.warehouses;
create policy warehouses_update on public.warehouses for update
  using (public.is_owner(id)) with check (public.is_owner(id));

drop policy if exists warehouses_delete on public.warehouses;
create policy warehouses_delete on public.warehouses for delete
  using (public.is_owner(id));

-- warehouse_members
drop policy if exists members_select on public.warehouse_members;
create policy members_select on public.warehouse_members for select
  using (public.is_member(warehouse_id));

drop policy if exists members_insert on public.warehouse_members;
create policy members_insert on public.warehouse_members for insert
  with check (
    -- vkládá sám sebe (přijímá pozvánku) nebo je owner
    user_id = auth.uid() or public.is_owner(warehouse_id)
  );

-- Owners can update member rows (promote/demote role). The enforce_at_least_one_owner
-- trigger prevents demoting the last owner.
drop policy if exists members_update on public.warehouse_members;
create policy members_update on public.warehouse_members for update
  using (public.is_owner(warehouse_id))
  with check (public.is_owner(warehouse_id));

drop policy if exists members_delete on public.warehouse_members;
create policy members_delete on public.warehouse_members for delete
  using (public.is_owner(warehouse_id) or user_id = auth.uid());

-- invitations: member vidí, owner spravuje
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select
  using (public.is_member(warehouse_id));

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations for insert
  with check (public.is_owner(warehouse_id));

drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations for update
  using (public.is_owner(warehouse_id) or auth.uid() is not null)
  with check (true);

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete
  using (public.is_owner(warehouse_id));

-- boxes: všichni členové čtou/editují, jen owner maže
drop policy if exists boxes_select on public.boxes;
create policy boxes_select on public.boxes for select
  using (public.is_member(warehouse_id));

drop policy if exists boxes_insert on public.boxes;
create policy boxes_insert on public.boxes for insert
  with check (public.is_member(warehouse_id));

drop policy if exists boxes_update on public.boxes;
create policy boxes_update on public.boxes for update
  using (public.is_member(warehouse_id)) with check (public.is_member(warehouse_id));

drop policy if exists boxes_delete on public.boxes;
create policy boxes_delete on public.boxes for delete
  using (public.is_owner(warehouse_id));

-- items: členové CRUD
drop policy if exists items_select on public.items;
create policy items_select on public.items for select
  using (public.is_member((select warehouse_id from public.boxes where id = box_id)));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert
  with check (public.is_member((select warehouse_id from public.boxes where id = box_id)));

drop policy if exists items_update on public.items;
create policy items_update on public.items for update
  using (public.is_member((select warehouse_id from public.boxes where id = box_id)))
  with check (public.is_member((select warehouse_id from public.boxes where id = box_id)));

drop policy if exists items_delete on public.items;
create policy items_delete on public.items for delete
  using (public.is_member((select warehouse_id from public.boxes where id = box_id)));

-- inventory_sessions: members of the box's warehouse can CRUD
drop policy if exists inventory_sessions_select on public.inventory_sessions;
create policy inventory_sessions_select on public.inventory_sessions for select
  using (public.is_member((select warehouse_id from public.boxes where id = box_id)));

drop policy if exists inventory_sessions_insert on public.inventory_sessions;
create policy inventory_sessions_insert on public.inventory_sessions for insert
  with check (public.is_member((select warehouse_id from public.boxes where id = box_id)));

drop policy if exists inventory_sessions_update on public.inventory_sessions;
create policy inventory_sessions_update on public.inventory_sessions for update
  using (public.is_member((select warehouse_id from public.boxes where id = box_id)))
  with check (public.is_member((select warehouse_id from public.boxes where id = box_id)));

drop policy if exists inventory_sessions_delete on public.inventory_sessions;
create policy inventory_sessions_delete on public.inventory_sessions for delete
  using (public.is_member((select warehouse_id from public.boxes where id = box_id)));

-- inventory_lines: access via session → box → warehouse membership
drop policy if exists inventory_lines_select on public.inventory_lines;
create policy inventory_lines_select on public.inventory_lines for select
  using (public.is_member((select warehouse_id from public.boxes where id = (
    select box_id from public.inventory_sessions where id = session_id
  ))));

drop policy if exists inventory_lines_insert on public.inventory_lines;
create policy inventory_lines_insert on public.inventory_lines for insert
  with check (public.is_member((select warehouse_id from public.boxes where id = (
    select box_id from public.inventory_sessions where id = session_id
  ))));

-- custom_products: členové CRUD
drop policy if exists custom_products_select on public.custom_products;
create policy custom_products_select on public.custom_products for select
  using (public.is_member(warehouse_id));

drop policy if exists custom_products_insert on public.custom_products;
create policy custom_products_insert on public.custom_products for insert
  with check (public.is_member(warehouse_id));

drop policy if exists custom_products_update on public.custom_products;
create policy custom_products_update on public.custom_products for update
  using (public.is_member(warehouse_id)) with check (public.is_member(warehouse_id));

drop policy if exists custom_products_delete on public.custom_products;
create policy custom_products_delete on public.custom_products for delete
  using (public.is_member(warehouse_id));

-- ============================================================================
-- REALTIME PUBLICATION
-- ============================================================================
-- Supabase používá `supabase_realtime` publication pro postgres_changes
-- events. Tabulky musí být explicitně přidány, jinak `subscribeBoxes` /
-- `subscribeItems` ve Kalta klientovi nedostanou žádné eventy.
--
-- DO block s exception handlingem — kdyby už tabulky v publication byly
-- (při re-runu schematu), alter by hodil duplicate_object error.

do $$ begin
  alter publication supabase_realtime add table public.boxes;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.warehouses;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.warehouse_members;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.inventory_sessions;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- STORAGE
-- ============================================================================
-- product-images bucket pro fotky produktů (Claude Vision, manuální foto)
-- Public: ON — obrázky jsou dostupné přes HTTPS URL bez auth.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Storage RLS: public reads (bucket is public, so this is a no-op on
-- select). Writes (insert / update / delete) require an authenticated
-- user. We intentionally don't enforce path-based warehouse membership
-- here — the client always writes under `{warehouseId}/...` and
-- RLS-protected DB tables already gate which warehouses the client can
-- touch. Good enough for MVP; tighten later if needed.

drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists product_images_insert on storage.objects;
create policy product_images_insert on storage.objects for insert
  with check (bucket_id = 'product-images' and auth.role() = 'authenticated');

drop policy if exists product_images_update on storage.objects;
create policy product_images_update on storage.objects for update
  using (bucket_id = 'product-images' and auth.role() = 'authenticated')
  with check (bucket_id = 'product-images' and auth.role() = 'authenticated');

drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects for delete
  using (bucket_id = 'product-images' and auth.role() = 'authenticated');
