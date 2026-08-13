"use client";

import { useState, type FormEvent } from "react";

type Recipe = {
  recipe_id: string;
  title: string;
  ingredients: string[];
  pantry_items_used: string[];
  prep_time_minutes: number;
  reason: string;
};

function isPantryIngredient(ingredient: string, pantryItemsUsed: string[]): boolean {
  const lower = ingredient.toLowerCase();
  return pantryItemsUsed.some((used) => lower.includes(used.toLowerCase()));
}

export function RecipesClient() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customRequest, setCustomRequest] = useState("");

  async function fetchRecipes(request?: string) {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: request ? { "Content-Type": "application/json" } : undefined,
        body: request ? JSON.stringify({ request }) : undefined,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to get recommendations");
      }
      setRecipes(result.recipes as Recipe[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get recommendations");
    } finally {
      setHasLoaded(true);
      setIsLoading(false);
    }
  }

  async function handleCustomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customRequest.trim()) return;
    await fetchRecipes(customRequest.trim());
  }

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Finding recipes…</p>
      ) : !hasLoaded ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Get 3 recipes based on what&apos;s in your pantry right now, prioritizing
            items closest to expiring.
          </p>
          <button
            type="button"
            onClick={() => fetchRecipes()}
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Get recommendations
          </button>
        </div>
      ) : recipes.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No recommendations yet — add items to your pantry first.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => (
            <article
              key={recipe.recipe_id}
              className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
            >
              <h3 className="font-medium">{recipe.title}</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                ~{recipe.prep_time_minutes} min
              </p>
              <ul className="flex flex-wrap gap-1.5 text-sm">
                {recipe.ingredients.map((ingredient, index) => (
                  <li
                    key={index}
                    className={
                      isPantryIngredient(ingredient, recipe.pantry_items_used)
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                        : "rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }
                  >
                    {ingredient}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{recipe.reason}</p>
            </article>
          ))}
        </div>
      )}

      <form
        onSubmit={handleCustomSubmit}
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800"
      >
        <div>
          <h2 className="font-medium">Want something specific?</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            e.g. &ldquo;I want to use up the spinach&rdquo; or &ldquo;I feel like pasta
            tonight&rdquo;
          </p>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            value={customRequest}
            onChange={(event) => setCustomRequest(event.target.value)}
            placeholder="I feel like pasta tonight"
            disabled={isLoading}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={isLoading || !customRequest.trim()}
            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isLoading ? "Thinking…" : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}
