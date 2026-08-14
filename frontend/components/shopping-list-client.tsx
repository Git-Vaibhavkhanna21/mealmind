"use client";

import { useState } from "react";

type ShoppingListItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  rationale: string | null;
  purchased: boolean;
};

export function ShoppingListClient({ initialItems }: { initialItems: ShoppingListItem[] }) {
  const [items, setItems] = useState<ShoppingListItem[]>(initialItems);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate() {
    setIsRegenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/shopping-list", { method: "POST" });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to regenerate shopping list");
      }
      const newItems = (result.items as ShoppingListItem[]) ?? [];
      setItems((current) => [...newItems, ...current.filter((item) => item.purchased)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate shopping list");
    } finally {
      setIsRegenerating(false);
    }
  }

  async function handleTogglePurchased(item: ShoppingListItem) {
    setTogglingId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/shopping-list-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchased: !item.purchased }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to update item");
      }
      setItems((current) =>
        current.map((i) => (i.id === item.id ? (result.item as ShoppingListItem) : i)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setTogglingId(null);
    }
  }

  const sortedItems = [...items].sort((a, b) => Number(a.purchased) - Number(b.purchased));
  const toBuyCount = items.filter((item) => !item.purchased).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {toBuyCount} item{toBuyCount === 1 ? "" : "s"} to buy
        </p>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isRegenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {sortedItems.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No items yet — click Regenerate to build a list from your pantry and cooking history.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {sortedItems.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-3">
              <input
                type="checkbox"
                checked={item.purchased}
                disabled={togglingId === item.id}
                onChange={() => handleTogglePurchased(item)}
                className="mt-1"
              />
              <div className={item.purchased ? "opacity-50" : undefined}>
                <p className={`font-medium capitalize ${item.purchased ? "line-through" : ""}`}>
                  {item.name}
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {[item.quantity, item.unit].filter(Boolean).join(" ") || "—"}
                </p>
                {item.rationale && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-500">{item.rationale}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
