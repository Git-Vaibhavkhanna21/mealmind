"use client";

import { createClient } from "@/lib/supabase/client";

export function GoogleSignInButton() {
  const supabase = createClient();

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <button
      onClick={signInWithGoogle}
      className="flex h-12 w-full items-center justify-center rounded-[var(--radius)] bg-amber text-base font-semibold text-white transition hover:opacity-90"
    >
      Continue with Google
    </button>
  );
}
