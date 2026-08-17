"use client";

import { useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { Award, ChevronLeft, Flame, Sprout } from "lucide-react";

type CookingSkill = "beginner" | "intermediate" | "advanced";

const COOKING_SKILLS: {
  value: CookingSkill;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}[] = [
  {
    value: "beginner",
    label: "Beginner",
    description: "Simple recipes, minimal techniques",
    icon: Sprout,
  },
  {
    value: "intermediate",
    label: "Intermediate",
    description: "Comfortable with most techniques",
    icon: Flame,
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "Complex recipes, confident experimenter",
    icon: Award,
  },
];

const DIETARY_OPTIONS = ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "Halal", "Kosher"];

const COOKING_TIME_OPTIONS: { label: string; value: number }[] = [
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "45 min", value: 45 },
  { label: "60+ min", value: 60 },
];

const STEP_COUNT = 3;

export function OnboardingClient() {
  const router = useRouter();
  const [step, setStep] = useState(0);
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

  const canProceed =
    step === 0 ? cookingSkill !== null : step === 2 ? maxCookingTime !== null : true;

  function handleBack() {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }

  async function handleNext() {
    if (!canProceed) return;
    setError(null);

    if (step < STEP_COUNT - 1) {
      setStep((current) => current + 1);
      return;
    }

    if (cookingSkill === null || maxCookingTime === null) return;

    setIsSubmitting(true);
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
    <div className="flex w-full flex-1 flex-col">
      <div className="mb-6 h-6">
        {step > 0 && (
          <button type="button" onClick={handleBack} aria-label="Back" className="text-text-mid">
            <ChevronLeft size={24} />
          </button>
        )}
      </div>

      <div className="flex-1">
        {step === 0 && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="font-display text-2xl text-text">How&apos;s your cooking?</h2>
              <p className="mt-1 text-sm text-muted">This shapes the recipes we suggest.</p>
            </div>
            <div className="flex flex-col gap-3">
              {COOKING_SKILLS.map((skill) => {
                const Icon = skill.icon;
                const isSelected = cookingSkill === skill.value;
                return (
                  <button
                    key={skill.value}
                    type="button"
                    onClick={() => setCookingSkill(skill.value)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-4 rounded-[var(--radius)] border p-4 text-left transition ${
                      isSelected ? "border-amber bg-amber-light" : "border-border bg-surface"
                    }`}
                  >
                    <Icon size={26} className={isSelected ? "text-amber" : "text-muted"} />
                    <div>
                      <p className="font-display text-lg font-medium text-text">{skill.label}</p>
                      <p className="text-sm text-text-mid">{skill.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="font-display text-2xl text-text">Any dietary restrictions?</h2>
              <p className="mt-1 text-sm text-muted">Select any that apply.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectNone}
                aria-pressed={noneSelected}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  noneSelected
                    ? "border-amber bg-amber text-white"
                    : "border-border bg-surface text-text-mid"
                }`}
              >
                None
              </button>
              {DIETARY_OPTIONS.map((option) => {
                const isSelected = dietaryRestrictions.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleDietaryOption(option)}
                    aria-pressed={isSelected}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                      isSelected
                        ? "border-amber bg-amber text-white"
                        : "border-border bg-surface text-text-mid"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="font-display text-2xl text-text">How much time do you have?</h2>
              <p className="mt-1 text-sm text-muted">For a typical weeknight meal.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {COOKING_TIME_OPTIONS.map((option) => {
                const isSelected = maxCookingTime === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setMaxCookingTime(option.value)}
                    aria-pressed={isSelected}
                    className={`rounded-[var(--radius)] border py-6 text-center text-lg font-medium transition ${
                      isSelected
                        ? "border-amber bg-amber-light text-amber"
                        : "border-border bg-surface text-text-mid"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-urgent">{error}</p>}

      <div className="mt-auto flex flex-col items-center gap-4 pt-10">
        <div className="flex gap-2">
          {Array.from({ length: STEP_COUNT }).map((_, index) => (
            <span
              key={index}
              className={`h-2 w-2 rounded-full transition ${
                index === step ? "bg-amber" : "bg-amber-muted"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={handleNext}
          disabled={!canProceed || isSubmitting}
          className="flex h-12 w-full items-center justify-center rounded-[var(--radius)] bg-amber text-base font-semibold text-white transition disabled:pointer-events-none disabled:opacity-50"
        >
          {step === STEP_COUNT - 1 ? (isSubmitting ? "Saving…" : "Get started") : "Next"}
        </button>
      </div>
    </div>
  );
}
