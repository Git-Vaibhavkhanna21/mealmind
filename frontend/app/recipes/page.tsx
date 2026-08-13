import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RecipesClient } from "@/components/recipes-client";

export default async function RecipesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-8 sm:p-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recipes</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Recommendations based on what&apos;s in your pantry right now.
        </p>
      </div>
      <RecipesClient />
    </main>
  );
}
