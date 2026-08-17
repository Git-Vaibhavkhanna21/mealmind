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

    redirect(existingUser?.onboarding_complete ? "/pantry" : "/onboarding");
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <h1 className="font-display text-5xl text-amber">MealMind</h1>
      <p className="text-lg text-text-mid">Your fridge, finally under control.</p>
      <p className="text-sm text-muted">
        Track what you have. Cook what matters. Waste nothing.
      </p>
      <div className="mt-6 w-full max-w-[320px]">
        <GoogleSignInButton />
      </div>
    </main>
  );
}
