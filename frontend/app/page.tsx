import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: existingUser } = await supabase
      .from("users")
      .select("onboarding_complete")
      .eq("id", user.id)
      .maybeSingle();

    redirect(
      existingUser?.onboarding_complete ? "/pantry" : "/onboarding",
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">MealMind</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Track your pantry, get recipe ideas, and never waste food again.
      </p>
      <GoogleSignInButton />
    </main>
  );
}
