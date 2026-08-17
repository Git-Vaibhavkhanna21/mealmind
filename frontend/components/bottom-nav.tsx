"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChefHat, Settings, ShoppingBasket, ShoppingCart } from "lucide-react";

const TABS = [
  { href: "/pantry", label: "Pantry", icon: ShoppingBasket },
  { href: "/recipes", label: "Recipes", icon: ChefHat },
  { href: "/shopping-list", label: "Shopping", icon: ShoppingCart },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Same routes the old top nav hid itself on — a signed-out landing page and
// mid-onboarding don't have anywhere for these tabs to point yet.
const HIDDEN_ROUTES = new Set(["/", "/onboarding"]);

export function BottomNav() {
  const pathname = usePathname();

  if (HIDDEN_ROUTES.has(pathname)) {
    return null;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[72px] w-full items-center justify-around border-t border-border bg-surface shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-1"
          >
            <span
              className={`flex h-9 w-14 items-center justify-center rounded-full transition ${
                isActive ? "bg-amber-light" : ""
              }`}
            >
              <Icon
                size={22}
                strokeWidth={isActive ? 2.25 : 2}
                className={isActive ? "text-amber" : "text-muted"}
              />
            </span>
            <span className={`text-[11px] font-medium ${isActive ? "text-amber" : "text-muted"}`}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
