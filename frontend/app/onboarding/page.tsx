import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingClient } from "@/components/onboarding-client";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-8 p-8 sm:p-16">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to MealMind</h1>
        <p className="mt-1 max-w-md text-zinc-600 dark:text-zinc-400">
          A few quick questions so we can tailor recommendations to you.
        </p>
      </div>
      <OnboardingClient />
    </main>
  );
}
