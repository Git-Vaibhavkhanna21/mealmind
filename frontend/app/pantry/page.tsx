import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PantryClient } from "@/components/pantry-client";

function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  return Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

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

  const pantryItems = items ?? [];
  const totalCount = pantryItems.length;
  const expiringSoonCount = pantryItems.filter((item) => {
    const days = daysUntilExpiry(item.expiry_date);
    return days !== null && days <= 7;
  }).length;

  return (
    <main className="flex min-h-screen flex-1 flex-col gap-6 bg-bg px-4 pt-8">
      <div>
        <h1 className="font-display text-[28px] text-text">My Pantry</h1>
        <p className="mt-1 text-[13px] text-muted">
          {totalCount} item{totalCount === 1 ? "" : "s"} &middot; {expiringSoonCount} expiring soon
        </p>
      </div>
      <PantryClient initialItems={pantryItems} />
    </main>
  );
}
