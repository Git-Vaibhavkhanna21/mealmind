import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShoppingListClient } from "@/components/shopping-list-client";

export default async function ShoppingListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: items } = await supabase
    .from("shopping_list_items")
    .select("*")
    .eq("user_id", user.id)
    .order("purchased", { ascending: true })
    .order("added_at", { ascending: false });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-8 sm:p-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shopping List</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Suggested based on your pantry, cooking history, and preferences.
        </p>
      </div>
      <ShoppingListClient initialItems={items ?? []} />
    </main>
  );
}
