-- Adds the recipe photo column that PR #30's frontend redesign was built
-- against but couldn't populate: TheMealDB's strMealThumb is fetched and
-- normalized (as "thumbnail") in api/mcp_servers/recipe_database.py, but
-- database/seed_recipes.py never wrote it to `recipes`, so there was no
-- column to hold it. Run in the Supabase SQL Editor (or `supabase db push`)
-- same as migrations/0001_init.sql and 0002_match_recipes.sql.
--
-- This migration only adds the column — it does not backfill existing rows,
-- update match_recipes' return columns, or thread the value through
-- meal_recommender.py and the frontend's Recipe type. Existing rows will
-- have thumbnail_url = null until a follow-up backfill runs.

alter table recipes add column thumbnail_url text;
