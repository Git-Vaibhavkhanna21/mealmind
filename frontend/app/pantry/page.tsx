import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PantryClient } from "@/components/pantry-client";

export default async function PantryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: items } = await supabase
    .from("pantry_items")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_depleted", false)
    .order("purchase_date", { ascending: false });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-8 sm:p-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pantry</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">Welcome, {user.email}</p>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Upload a receipt to add items automatically, or enter them by hand.
        </p>
      </div>
      <PantryClient initialItems={items ?? []} />
    </main>
  );
}
