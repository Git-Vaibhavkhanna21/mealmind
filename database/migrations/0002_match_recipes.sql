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
language plpgsql
as $$
begin
  -- migrations/0001_init.sql built the ivfflat index with `lists = 100`,
  -- tuned for a much larger corpus — at today's ~200 seeded recipes that's
  -- ~2 rows per list. Postgres's default `ivfflat.probes = 1` then only
  -- scans one (often near-empty) list, so plenty of query vectors come back
  -- with zero or near-zero candidates even though the table is fully
  -- populated. `set local` here (rather than a `create function ... set`
  -- clause) is deliberate: attaching config to the function's catalog entry
  -- needs a privilege the Supabase SQL Editor role doesn't have for
  -- extension GUCs, but running `set local` as an ordinary statement inside
  -- the function body doesn't — it does mean the function can't be marked
  -- `stable` (Postgres requires `volatile` for a function with a `set`
  -- side effect), which is fine for a leaf RPC called once per request.
  -- Forcing (near-)exhaustive scanning is exact and still cheap at this
  -- scale; revisit once the catalog is large enough for approximate search
  -- to matter for latency.
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
      1 - (recipes.embedding <=> match_recipes.query_embedding) as similarity
    from recipes
    order by recipes.embedding <=> match_recipes.query_embedding
    limit match_recipes.match_count;
end;
$$;

-- recipes is a shared, RLS-protected catalog (see migrations/0001_init.sql);
-- grant execute to the same authenticated role that can already read it.
grant execute on function match_recipes(vector(1536), int) to authenticated;
