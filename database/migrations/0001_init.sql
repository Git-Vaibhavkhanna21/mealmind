-- MealMind initial schema: core tables, RLS policies, pgvector.
-- Run in the Supabase SQL Editor (or `supabase db push`) against the project.

create extension if not exists vector;
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- users
--
-- id is the same UUID as auth.users.id (set by the app on first sign-in),
-- so RLS can compare directly against auth.uid() with no extra join.
-- ---------------------------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  google_id text unique,
  cooking_skill text check (cooking_skill in ('beginner', 'intermediate', 'advanced')),
  dietary_restrictions text[] not null default '{}',
  max_cooking_time integer,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pantry_items
-- ---------------------------------------------------------------------------
create table if not exists pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text,
  purchase_date date not null,
  expiry_date date,
  is_depleted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists pantry_items_user_id_idx on pantry_items(user_id);

-- ---------------------------------------------------------------------------
-- recipes
--
-- Shared catalog, not owned by a single user, so RLS policies are read-only
-- for authenticated users rather than scoped to a user_id column.
-- ---------------------------------------------------------------------------
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  themealdb_id text unique,
  title text not null,
  ingredients jsonb,
  instructions text,
  cuisine text,
  prep_time integer,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- user_recipe_history
-- ---------------------------------------------------------------------------
create table if not exists user_recipe_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  cooked_at timestamptz,
  confirmed_cooked boolean not null default false
);

create index if not exists user_recipe_history_user_id_idx on user_recipe_history(user_id);
create index if not exists user_recipe_history_recipe_id_idx on user_recipe_history(recipe_id);

-- ---------------------------------------------------------------------------
-- shopping_list_items
-- ---------------------------------------------------------------------------
create table if not exists shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text,
  rationale text,
  added_at timestamptz not null default now(),
  purchased boolean not null default false
);

create index if not exists shopping_list_items_user_id_idx on shopping_list_items(user_id);

-- ---------------------------------------------------------------------------
-- pgvector index for recipe similarity search
--
-- ivfflat needs training data to build good clusters; if this is run against
-- an empty recipes table, consider re-running (or ANALYZE) after the initial
-- recipe import for a better plan.
-- ---------------------------------------------------------------------------
create index if not exists recipes_embedding_ivfflat_idx
  on recipes using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table users enable row level security;
alter table pantry_items enable row level security;
alter table recipes enable row level security;
alter table user_recipe_history enable row level security;
alter table shopping_list_items enable row level security;

-- users: a user may only read/update their own row. Row creation happens via
-- the app right after auth (insert policy checks the new row's id matches
-- the caller), never via a service-managed trigger.
create policy "Users can view own row" on users
  for select using (auth.uid() = id);

create policy "Users can insert own row" on users
  for insert with check (auth.uid() = id);

create policy "Users can update own row" on users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- pantry_items: full CRUD scoped to the owning user.
create policy "Users can view own pantry items" on pantry_items
  for select using (auth.uid() = user_id);

create policy "Users can insert own pantry items" on pantry_items
  for insert with check (auth.uid() = user_id);

create policy "Users can update own pantry items" on pantry_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete own pantry items" on pantry_items
  for delete using (auth.uid() = user_id);

-- recipes: shared catalog, readable by any authenticated user; writes are
-- reserved for the service role (recipe ingestion pipeline), so no
-- insert/update/delete policy is defined for regular users.
create policy "Authenticated users can view recipes" on recipes
  for select using (auth.role() = 'authenticated');

-- user_recipe_history: full CRUD scoped to the owning user.
create policy "Users can view own recipe history" on user_recipe_history
  for select using (auth.uid() = user_id);

create policy "Users can insert own recipe history" on user_recipe_history
  for insert with check (auth.uid() = user_id);

create policy "Users can update own recipe history" on user_recipe_history
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete own recipe history" on user_recipe_history
  for delete using (auth.uid() = user_id);

-- shopping_list_items: full CRUD scoped to the owning user.
create policy "Users can view own shopping list items" on shopping_list_items
  for select using (auth.uid() = user_id);

create policy "Users can insert own shopping list items" on shopping_list_items
  for insert with check (auth.uid() = user_id);

create policy "Users can update own shopping list items" on shopping_list_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete own shopping list items" on shopping_list_items
  for delete using (auth.uid() = user_id);
