"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="flex h-12 w-full items-center justify-center rounded-[var(--radius)] bg-amber text-base font-semibold text-white transition hover:opacity-90"
    >
      Sign Out
    </button>
  );
}
