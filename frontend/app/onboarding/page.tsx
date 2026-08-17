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
    <main className="flex min-h-screen flex-1 flex-col bg-bg px-6 pt-10 pb-8">
      <h1 className="font-display text-center text-2xl text-amber">MealMind</h1>
      <div className="mt-8 flex flex-1 flex-col">
        <OnboardingClient />
      </div>
    </main>
  );
}
