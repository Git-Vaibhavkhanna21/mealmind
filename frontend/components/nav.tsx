"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV_LINKS = [
  { href: "/pantry", label: "Pantry" },
  { href: "/recipes", label: "Recipes" },
  { href: "/shopping-list", label: "Shopping List" },
];

// Pages a signed-out user (or one mid-onboarding) can land on — the nav
// doesn't make sense there, since /onboarding hasn't set up preferences
// yet and / is the signed-out landing page.
const HIDDEN_ROUTES = new Set(["/", "/onboarding"]);

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  if (HIDDEN_ROUTES.has(pathname)) {
    return null;
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <nav className="flex items-center justify-between gap-4 bg-zinc-900 px-6 py-3 text-zinc-100">
      <div className="flex items-center gap-6">
        <Link href="/pantry" className="font-semibold tracking-tight">
          MealMind
        </Link>
        <div className="flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
      >
        Sign Out
      </button>
    </nav>
  );
}
