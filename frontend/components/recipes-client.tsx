"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowRight, Clock } from "lucide-react";

export type Recipe = {
  recipe_id: string;
  title: string;
  ingredients: string[];
  pantry_items_used: string[];
  prep_time_minutes: number;
  reason: string;
  // Not yet populated end-to-end (see DEVLOG) — the recipes table and the
  // meal_recommender selection step don't carry TheMealDB's strMealThumb
  // through today, so this is always undefined until that's wired up. The
  // placeholder gradient below is the real-world default, not just a
  // theoretical fallback.
  thumbnail?: string | null;
};

type DeductionItem = {
  pantry_item_id: string;
  pantry_item_name: string;
  quantity_to_deduct: number;
  unit: string;
  confidence: number;
};

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export function RecipesClient({ initialRecipes }: { initialRecipes: Recipe[] }) {
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);
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
      const response = await fetch(request ? "/api/custom-recipe" : "/api/recommend", {
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
      setIsLoading(false);
    }
  }

  async function handleCustomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customRequest.trim()) return;
    const request = customRequest.trim();
    setCustomRequest("");
    await fetchRecipes(request);
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
    <div className="flex flex-1 flex-col gap-6 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] text-text">Recipes</h1>
        <button
          type="button"
          onClick={() => fetchRecipes()}
          disabled={isLoading}
          className="rounded-[20px] border border-amber bg-white px-4 py-1.5 text-[13px] text-amber transition disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoading ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      <form
        onSubmit={handleCustomSubmit}
        className="flex h-12 items-center gap-1.5 rounded-[var(--radius)] border border-border bg-surface pr-1.5 pl-4 focus-within:outline focus-within:outline-2 focus-within:outline-amber"
      >
        <input
          type="text"
          value={customRequest}
          onChange={(event) => setCustomRequest(event.target.value)}
          placeholder="What are you in the mood for?"
          disabled={isLoading}
          className="h-full flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={isLoading || !customRequest.trim()}
          aria-label="Get recipe"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber text-white transition disabled:pointer-events-none disabled:opacity-50"
        >
          <ArrowRight size={16} />
        </button>
      </form>

      {error && <p className="text-sm text-urgent">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-muted">Finding recipes…</p>
      ) : recipes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <h2 className="font-display text-2xl text-text">Nothing here yet</h2>
          <p className="text-sm text-muted">
            Add groceries to your pantry and we will find recipes for you
          </p>
          <Link
            href="/pantry"
            className="mt-2 rounded-[var(--radius)] bg-amber px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Go to Pantry
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.recipe_id} recipe={recipe} onCookThis={() => handleCookThis(recipe)} />
          ))}
        </div>
      )}

      {cookingRecipe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-md flex-col gap-4 rounded-[var(--radius)] bg-surface p-6">
            <div>
              <h2 className="font-display text-lg text-text">Cook &ldquo;{cookingRecipe.title}&rdquo;?</h2>
              <p className="text-sm text-muted">Review what will be deducted from your pantry.</p>
            </div>

            {isBuildingPlan ? (
              <p className="text-sm text-muted">Checking your pantry…</p>
            ) : deductionPlan && deductionPlan.length === 0 ? (
              <p className="text-sm text-muted">
                No pantry items matched closely enough to deduct automatically.
              </p>
            ) : deductionPlan ? (
              <ul className="flex flex-col divide-y divide-border">
                {deductionPlan.map((entry) => (
                  <li
                    key={entry.pantry_item_id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium capitalize text-text">{entry.pantry_item_name}</p>
                      <p className="text-muted">
                        -{entry.quantity_to_deduct} {entry.unit}
                      </p>
                    </div>
                    <span
                      className={
                        entry.confidence < LOW_CONFIDENCE_THRESHOLD
                          ? "rounded-full bg-warning-light px-2 py-0.5 text-xs font-medium text-warning"
                          : "rounded-full bg-green-light px-2 py-0.5 text-xs font-medium text-green"
                      }
                    >
                      {Math.round(entry.confidence * 100)}% match
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {cookError && <p className="text-sm text-urgent">{cookError}</p>}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeCookModal}
                disabled={isConfirmingCook}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text transition disabled:pointer-events-none disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCook}
                disabled={isBuildingPlan || isConfirmingCook || !deductionPlan}
                className="rounded-full bg-amber px-4 py-2 text-sm font-medium text-white transition disabled:pointer-events-none disabled:opacity-50"
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

function RecipeCard({ recipe, onCookThis }: { recipe: Recipe; onCookThis: () => void }) {
  return (
    <article
      className="w-full overflow-hidden rounded-[var(--radius)] bg-surface"
      style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
    >
      {recipe.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={recipe.thumbnail}
          alt={recipe.title}
          className="h-[180px] w-full rounded-t-[var(--radius)] object-cover"
        />
      ) : (
        <div
          className="h-[180px] w-full rounded-t-[var(--radius)]"
          style={{ background: "linear-gradient(135deg, var(--amber-muted), var(--amber-light))" }}
        />
      )}

      <div className="p-4">
        <h3 className="line-clamp-2 font-display text-[18px] font-semibold text-text">
          {recipe.title}
        </h3>

        {recipe.pantry_items_used.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wide text-muted">Uses from your pantry:</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {recipe.pantry_items_used.map((item) => (
                <span
                  key={item}
                  className="rounded-[20px] bg-amber-light px-2 py-0.5 text-[11px] text-amber"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2 flex items-center gap-1">
          <Clock size={14} className="text-muted" />
          <span className="text-[12px] text-muted">{recipe.prep_time_minutes} min</span>
        </div>

        <p className="mt-2 line-clamp-2 text-[13px] italic text-text-mid">{recipe.reason}</p>

        <button
          type="button"
          onClick={onCookThis}
          className="mt-3 h-11 w-full rounded-[var(--radius-sm)] bg-amber text-sm font-semibold text-white transition hover:opacity-90"
        >
          Cook This
        </button>
      </div>
    </article>
  );
}
