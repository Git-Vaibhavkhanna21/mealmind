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

type DeductionItem = {
  pantry_item_id: string;
  pantry_item_name: string;
  quantity_to_deduct: number;
  unit: string;
  confidence: number;
};

const LOW_CONFIDENCE_THRESHOLD = 0.7;

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

  const [cookingRecipe, setCookingRecipe] = useState<Recipe | null>(null);
  const [deductionPlan, setDeductionPlan] = useState<DeductionItem[] | null>(null);
  const [isBuildingPlan, setIsBuildingPlan] = useState(false);
  const [isConfirmingCook, setIsConfirmingCook] = useState(false);
  const [cookError, setCookError] = useState<string | null>(null);

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

  async function handleCookThis(recipe: Recipe) {
    setCookingRecipe(recipe);
    setDeductionPlan(null);
    setCookError(null);
    setIsBuildingPlan(true);
    try {
      const response = await fetch("/api/confirm-cook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe_id: recipe.recipe_id }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to build deduction plan");
      }
      setDeductionPlan(result.plan as DeductionItem[]);
    } catch (err) {
      setCookError(err instanceof Error ? err.message : "Failed to build deduction plan");
    } finally {
      setIsBuildingPlan(false);
    }
  }

  function closeCookModal() {
    setCookingRecipe(null);
    setDeductionPlan(null);
    setCookError(null);
  }

  async function handleConfirmCook() {
    if (!cookingRecipe || !deductionPlan) return;
    setIsConfirmingCook(true);
    setCookError(null);
    try {
      const response = await fetch("/api/confirm-cook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe_id: cookingRecipe.recipe_id,
          confirmed: true,
          plan: deductionPlan,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to confirm cook");
      }
      closeCookModal();
    } catch (err) {
      setCookError(err instanceof Error ? err.message : "Failed to confirm cook");
    } finally {
      setIsConfirmingCook(false);
    }
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
              <button
                type="button"
                onClick={() => handleCookThis(recipe)}
                className="mt-1 self-start rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Cook This
              </button>
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

      {cookingRecipe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-white p-6 dark:bg-zinc-900">
            <div>
              <h2 className="font-medium">Cook &ldquo;{cookingRecipe.title}&rdquo;?</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Review what will be deducted from your pantry.
              </p>
            </div>

            {isBuildingPlan ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Checking your pantry…</p>
            ) : deductionPlan && deductionPlan.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No pantry items matched closely enough to deduct automatically.
              </p>
            ) : deductionPlan ? (
              <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
                {deductionPlan.map((entry) => (
                  <li
                    key={entry.pantry_item_id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium capitalize">{entry.pantry_item_name}</p>
                      <p className="text-zinc-600 dark:text-zinc-400">
                        -{entry.quantity_to_deduct} {entry.unit}
                      </p>
                    </div>
                    <span
                      className={
                        entry.confidence < LOW_CONFIDENCE_THRESHOLD
                          ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          : "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300"
                      }
                    >
                      {Math.round(entry.confidence * 100)}% match
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {cookError && <p className="text-sm text-red-600 dark:text-red-400">{cookError}</p>}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeCookModal}
                disabled={isConfirmingCook}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCook}
                disabled={isBuildingPlan || isConfirmingCook || !deductionPlan}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isConfirmingCook ? "Confirming…" : "Confirm Cook"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
