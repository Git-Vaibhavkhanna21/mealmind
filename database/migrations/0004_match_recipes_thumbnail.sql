-- Adds thumbnail_url (added to `recipes` by migrations/0003_add_thumbnail_url.sql)
-- to match_recipes' return columns, so agents/meal_recommender.py's candidate
-- list carries it through to the final recipe selection. Run in the Supabase
-- SQL Editor (or `supabase db push`) after 0003_add_thumbnail_url.sql, same
-- as the earlier migrations.
--
-- `create or replace function` can't change an existing function's return
-- type in place — Postgres requires the old one dropped first.
drop function if exists match_recipes(vector(1536), int);

create or replace function match_recipes(
  query_embedding vector(1536),
  match_count int default 10
)
returns table (
  id uuid,
  themealdb_id text,
  title text,
  ingredients jsonb,
  instructions text,
  cuisine text,
  prep_time integer,
  thumbnail_url text,
  similarity float
)
language plpgsql
as $$
begin
  -- See migrations/0002_match_recipes.sql for why this is set here rather
  -- than on the function's catalog entry, and why it can't be `stable`.
  set local ivfflat.probes = 1000;

  return query
    select
      recipes.id,
      recipes.themealdb_id,
      recipes.title,
      recipes.ingredients,
      recipes.instructions,
      recipes.cuisine,
      recipes.prep_time,
      recipes.thumbnail_url,
      1 - (recipes.embedding <=> match_recipes.query_embedding) as similarity
    from recipes
    order by recipes.embedding <=> match_recipes.query_embedding
    limit match_recipes.match_count;
end;
$$;

grant execute on function match_recipes(vector(1536), int) to authenticated;
