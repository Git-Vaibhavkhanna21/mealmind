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
    <main className="flex min-h-screen flex-1 flex-col gap-6 bg-bg px-4 pt-8">
      <ShoppingListClient initialItems={items ?? []} />
    </main>
  );
}
