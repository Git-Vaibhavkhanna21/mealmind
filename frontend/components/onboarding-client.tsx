"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type CookingSkill = "beginner" | "intermediate" | "advanced";

const COOKING_SKILLS: { value: CookingSkill; label: string; description: string }[] = [
  { value: "beginner", label: "Beginner", description: "Simple recipes, minimal techniques" },
  { value: "intermediate", label: "Intermediate", description: "Comfortable with most techniques" },
  { value: "advanced", label: "Advanced", description: "Complex recipes, confident experimenter" },
];

const DIETARY_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Gluten-free",
  "Dairy-free",
  "Halal",
  "Kosher",
];

const COOKING_TIME_OPTIONS: { label: string; value: number }[] = [
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "45 min", value: 45 },
  { label: "60+ min", value: 60 },
];

export function OnboardingClient() {
  const router = useRouter();
  const [cookingSkill, setCookingSkill] = useState<CookingSkill | null>(null);
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [noneSelected, setNoneSelected] = useState(false);
  const [maxCookingTime, setMaxCookingTime] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDietaryOption(option: string) {
    setNoneSelected(false);
    setDietaryRestrictions((current) =>
      current.includes(option) ? current.filter((o) => o !== option) : [...current, option],
    );
  }

  function selectNone() {
    setNoneSelected(true);
    setDietaryRestrictions([]);
  }

  const canSubmit = cookingSkill !== null && maxCookingTime !== null && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cookingSkill === null || maxCookingTime === null) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cooking_skill: cookingSkill,
          dietary_restrictions: dietaryRestrictions,
          max_cooking_time: maxCookingTime,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to save onboarding info");
      }
      router.push("/pantry");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save onboarding info");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-xl flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium">Cooking skill</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            How comfortable are you in the kitchen?
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {COOKING_SKILLS.map((skill) => (
            <button
              key={skill.value}
              type="button"
              onClick={() => setCookingSkill(skill.value)}
              aria-pressed={cookingSkill === skill.value}
              className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition ${
                cookingSkill === skill.value
                  ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              }`}
            >
              <span className="font-medium">{skill.label}</span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {skill.description}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium">Dietary restrictions</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Select any that apply.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label
            className={`cursor-pointer rounded-full border px-4 py-2 text-sm transition ${
              noneSelected
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            <input type="checkbox" checked={noneSelected} onChange={selectNone} className="hidden" />
            None
          </label>
          {DIETARY_OPTIONS.map((option) => {
            const checked = dietaryRestrictions.includes(option);
            return (
              <label
                key={option}
                className={`cursor-pointer rounded-full border px-4 py-2 text-sm transition ${
                  checked
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDietaryOption(option)}
                  className="hidden"
                />
                {option}
              </label>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium">Maximum cooking time</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            How long are you willing to spend on a weeknight meal?
          </p>
        </div>
        <div className="flex overflow-hidden rounded-full border border-zinc-300 dark:border-zinc-700">
          {COOKING_TIME_OPTIONS.map((option, index) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMaxCookingTime(option.value)}
              aria-pressed={maxCookingTime === option.value}
              className={`flex-1 px-4 py-2 text-sm font-medium transition ${
                maxCookingTime === option.value
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-white text-zinc-900 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
              } ${index > 0 ? "border-l border-zinc-300 dark:border-zinc-700" : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="self-start rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isSubmitting ? "Saving…" : "Get started"}
      </button>
    </form>
  );
}
