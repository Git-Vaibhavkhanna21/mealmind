-- pgvector similarity search RPC for recipe retrieval.
--
-- PostgREST (what supabase-py talks to) can't express `ORDER BY embedding
-- <=> query_embedding` through the table query builder, so the RAG step in
-- agents/meal_recommender.py calls this function via `supabase.rpc(...)`
-- instead of `.table("recipes")...`. Run in the Supabase SQL Editor (or
-- `supabase db push`) same as migrations/0001_init.sql.

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
  similarity float
)
language sql stable
as $$
  select
    recipes.id,
    recipes.themealdb_id,
    recipes.title,
    recipes.ingredients,
    recipes.instructions,
    recipes.cuisine,
    recipes.prep_time,
    1 - (recipes.embedding <=> match_recipes.query_embedding) as similarity
  from recipes
  order by recipes.embedding <=> match_recipes.query_embedding
  limit match_recipes.match_count;
$$;

-- recipes is a shared, RLS-protected catalog (see migrations/0001_init.sql);
-- grant execute to the same authenticated role that can already read it.
grant execute on function match_recipes(vector(1536), int) to authenticated;
