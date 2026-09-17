"use client";

import { useState } from "react";
import { Check } from "lucide-react";

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

  const unpurchased = items.filter((item) => !item.purchased);
  const purchased = items.filter((item) => item.purchased);
  const remainingCount = unpurchased.length;

  return (
    <div className="flex flex-1 flex-col gap-6 pb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[28px] text-text">Shopping List</h1>
          <p className="mt-1 text-[13px] text-muted">
            {remainingCount === 0
              ? "All done!"
              : `${remainingCount} item${remainingCount === 1 ? "" : "s"} remaining`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="rounded-[20px] border border-amber bg-white px-4 py-1.5 text-[13px] text-amber transition disabled:pointer-events-none disabled:opacity-50"
        >
          {isRegenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      {error && <p className="text-sm text-urgent">{error}</p>}

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <h2 className="font-display text-2xl text-text">Your list is empty</h2>
          <p className="text-sm text-muted">
            Generate a shopping list based on your pantry and cooking history
          </p>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="mt-2 rounded-[var(--radius)] bg-amber px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
          >
            {isRegenerating ? "Generating…" : "Generate List"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {unpurchased.map((item) => (
            <ShoppingListItemCard
              key={item.id}
              item={item}
              isToggling={togglingId === item.id}
              onToggle={() => handleTogglePurchased(item)}
            />
          ))}

          {purchased.length > 0 && (
            <>
              <div className="relative flex items-center py-1">
                <div className="h-px flex-1 bg-border" />
                <span className="px-3 text-[11px] uppercase tracking-wide text-muted">Purchased</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              {purchased.map((item) => (
                <ShoppingListItemCard
                  key={item.id}
                  item={item}
                  isToggling={togglingId === item.id}
                  onToggle={() => handleTogglePurchased(item)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ShoppingListItemCard({
  item,
  isToggling,
  onToggle,
}: {
  item: ShoppingListItem;
  isToggling: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-[var(--radius-sm)] border border-border p-[14px_16px] transition ${
        item.purchased ? "bg-bg" : "bg-surface"
      }`}
    >
      <div className="flex-1">
        <p
          className={`text-sm font-medium ${
            item.purchased ? "text-muted line-through" : "text-text"
          }`}
        >
          {item.name}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {[item.quantity, item.unit].filter(Boolean).join(" ") || "—"}
        </p>
        {item.rationale && (
          <p className="mt-0.5 text-xs italic text-text-mid">{item.rationale}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={isToggling}
        aria-label={item.purchased ? "Mark as not purchased" : "Mark as purchased"}
        aria-pressed={item.purchased}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition disabled:pointer-events-none disabled:opacity-50 ${
          item.purchased ? "border-amber bg-amber" : "border-border bg-transparent"
        }`}
      >
        {item.purchased && <Check size={14} className="text-white" strokeWidth={3} />}
      </button>
    </div>
  );
}
