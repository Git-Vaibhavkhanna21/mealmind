import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RecipesClient, type Recipe } from "@/components/recipes-client";
import { callPythonApi, parsePythonApiResponse, PythonApiError } from "@/lib/python-api";

async function fetchInitialRecipes(userId: string): Promise<Recipe[]> {
  try {
    const response = await callPythonApi("/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const result = await parsePythonApiResponse<{ recipes: Recipe[] }>(response);
    return result.recipes;
  } catch (error) {
    if (!(error instanceof PythonApiError)) {
      console.error("Failed to fetch initial recipes:", error);
    }
    return [];
  }
}

export default async function RecipesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const initialRecipes = await fetchInitialRecipes(user.id);

  return (
    <main className="flex min-h-screen flex-1 flex-col gap-6 bg-bg px-4 pt-8">
      <RecipesClient initialRecipes={initialRecipes} />
    </main>
  );
}
