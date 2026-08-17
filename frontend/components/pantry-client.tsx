"use client";

import Link from "next/link";
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Camera, ChevronDown, ChevronUp, Image as ImageIcon, Keyboard, Plus, Refrigerator } from "lucide-react";

type PantryItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  purchase_date: string;
  expiry_date: string | null;
  is_depleted: boolean;
};

type Category = "Proteins" | "Produce" | "Dairy" | "Grains and Pantry" | "Other";

// Simple keyword matching per the spec — deliberately not exhaustive; names
// that don't match any list fall through to "Other".
const CATEGORY_KEYWORDS: [Exclude<Category, "Other">, string[]][] = [
  ["Proteins", ["chicken", "beef", "fish", "eggs"]],
  ["Produce", ["spinach", "carrot", "onion", "apple", "banana"]],
  ["Dairy", ["milk", "yogurt", "cheese", "butter"]],
  ["Grains and Pantry", ["pasta", "rice", "bread", "oats"]],
];
const CATEGORY_ORDER: Category[] = ["Proteins", "Produce", "Dairy", "Grains and Pantry", "Other"];

function categorize(name: string): Category {
  const lower = name.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => lower.includes(keyword))) return category;
  }
  return "Other";
}

function groupByCategory(items: PantryItem[]): { category: Category; items: PantryItem[] }[] {
  const map = new Map<Category, PantryItem[]>();
  for (const item of items) {
    const category = categorize(item.name);
    if (!map.has(category)) map.set(category, []);
    map.get(category)!.push(item);
  }
  return CATEGORY_ORDER.filter((category) => map.has(category)).map((category) => ({
    category,
    items: map.get(category)!,
  }));
}

function daysUntil(expiryDate: string | null, today: Date): number | null {
  if (!expiryDate) return null;
  const expiry = new Date(`${expiryDate}T00:00:00`);
  return Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function sortByUrgency(items: PantryItem[], today: Date): PantryItem[] {
  return [...items].sort((a, b) => {
    const da = daysUntil(a.expiry_date, today);
    const db = daysUntil(b.expiry_date, today);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

function bucketByUrgency(items: PantryItem[], today: Date) {
  const useSoon: PantryItem[] = [];
  const thisMonth: PantryItem[] = [];
  const wellStocked: PantryItem[] = [];
  for (const item of items) {
    const days = daysUntil(item.expiry_date, today);
    if (days === null || days > 30) wellStocked.push(item);
    else if (days <= 7) useSoon.push(item);
    else thisMonth.push(item);
  }
  return {
    useSoon: sortByUrgency(useSoon, today),
    thisMonth: sortByUrgency(thisMonth, today),
    wellStocked: sortByUrgency(wellStocked, today),
  };
}

function ExpiryBadge({ expiryDate, today }: { expiryDate: string | null; today: Date }) {
  const days = daysUntil(expiryDate, today);

  if (days === null) {
    return (
      <span className="w-fit rounded-full bg-green-light px-2 py-0.5 text-xs font-medium text-green">
        No expiry date
      </span>
    );
  }

  if (days < 3) {
    const label = days < 0 ? "Expired" : days === 0 ? "Expires today" : `${days} day${days === 1 ? "" : "s"} left`;
    return (
      <span className="w-fit rounded-full bg-urgent-light px-2 py-0.5 text-xs font-medium text-urgent">
        {label}
      </span>
    );
  }

  if (days <= 7) {
    return (
      <span className="w-fit rounded-full bg-warning-light px-2 py-0.5 text-xs font-medium text-warning">
        {days} days left
      </span>
    );
  }

  const formatted = new Date(`${expiryDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return (
    <span className="w-fit rounded-full bg-green-light px-2 py-0.5 text-xs font-medium text-green">
      {formatted}
    </span>
  );
}

type ItemCardProps = {
  item: PantryItem;
  today: Date;
  isExpanded: boolean;
  onToggleExpand: () => void;
  editQuantity: string;
  onEditQuantityChange: (value: string) => void;
  onSave: () => void;
  onMarkDepleted: () => void;
  isSaving: boolean;
  editError: string | null;
};

function ItemCard({
  item,
  today,
  isExpanded,
  onToggleExpand,
  editQuantity,
  onEditQuantityChange,
  onSave,
  onMarkDepleted,
  isSaving,
  editError,
}: ItemCardProps) {
  return (
    <div
      onClick={onToggleExpand}
      className="cursor-pointer rounded-[var(--radius)] border border-border bg-surface p-3 shadow-sm transition"
    >
      <p className="text-sm font-medium text-text">{item.name}</p>
      <p className="mt-0.5 text-xs text-muted">
        {[item.quantity, item.unit].filter(Boolean).join(" ") || "—"}
      </p>
      <div className="mt-2">
        <ExpiryBadge expiryDate={item.expiry_date} today={today} />
      </div>

      {isExpanded && (
        <div
          onClick={(event) => event.stopPropagation()}
          className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
        >
          <label className="text-xs text-muted">
            Quantity
            <input
              type="number"
              value={editQuantity}
              onChange={(event) => onEditQuantityChange(event.target.value)}
              className="mt-1 w-full rounded-[var(--radius-sm)] border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-amber"
            />
          </label>
          {editError && <p className="text-xs text-urgent">{editError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="flex-1 rounded-full bg-amber py-1.5 text-xs font-semibold text-white transition disabled:pointer-events-none disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onMarkDepleted}
              disabled={isSaving}
              className="flex-1 rounded-full border border-border py-1.5 text-xs font-medium text-text-mid transition disabled:pointer-events-none disabled:opacity-50"
            >
              Mark as depleted
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PantryClient({ initialItems }: { initialItems: PantryItem[] }) {
  const [items, setItems] = useState<PantryItem[]>(initialItems);
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [isWellStockedExpanded, setIsWellStockedExpanded] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isTextSheetOpen, setIsTextSheetOpen] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const buckets = useMemo(() => bucketByUrgency(items, today), [items, today]);

  async function submitFormData(formData: FormData): Promise<boolean> {
    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch("/api/parse-receipt", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to parse receipt");
      }
      const addedItems = result.items as PantryItem[];
      setItems((current) => [...addedItems, ...current]);
      setText("");
      setSuccessMessage(
        `Added ${addedItems.length} item${addedItems.length === 1 ? "" : "s"} to your pantry.`,
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse receipt");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    await submitFormData(formData);
    event.target.value = "";
  }

  async function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    const formData = new FormData();
    formData.append("text", text);
    const succeeded = await submitFormData(formData);
    if (succeeded) {
      setIsTextSheetOpen(false);
    }
  }

  function openSheet() {
    setIsSheetOpen(true);
  }

  function handleTakePhoto() {
    setIsSheetOpen(false);
    cameraInputRef.current?.click();
  }

  function handleChooseFromLibrary() {
    setIsSheetOpen(false);
    libraryInputRef.current?.click();
  }

  function handleTypeManually() {
    setIsSheetOpen(false);
    setIsTextSheetOpen(true);
  }

  function toggleExpand(itemId: string) {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      return;
    }
    const item = items.find((i) => i.id === itemId);
    setExpandedItemId(itemId);
    setEditQuantity(item?.quantity === null || item?.quantity === undefined ? "" : String(item.quantity));
    setEditError(null);
  }

  async function saveEdit(itemId: string) {
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/pantry-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: editQuantity.trim() === "" ? null : Number(editQuantity),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to update item");
      }
      setItems((current) =>
        current.map((item) => (item.id === itemId ? (result.item as PantryItem) : item)),
      );
      setExpandedItemId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function markDepleted(itemId: string) {
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/pantry-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_depleted: true }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to update item");
      }
      setItems((current) => current.filter((item) => item.id !== itemId));
      setExpandedItemId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setIsSavingEdit(false);
    }
  }

  function cardPropsFor(item: PantryItem): ItemCardProps {
    const isExpanded = expandedItemId === item.id;
    return {
      item,
      today,
      isExpanded,
      onToggleExpand: () => toggleExpand(item.id),
      editQuantity,
      onEditQuantityChange: setEditQuantity,
      onSave: () => saveEdit(item.id),
      onMarkDepleted: () => markDepleted(item.id),
      isSaving: isSavingEdit,
      editError: isExpanded ? editError : null,
    };
  }

  const hasItems = items.length > 0;

  return (
    <div className="relative flex flex-1 flex-col gap-6 pb-6">
      {successMessage && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-green-200 bg-green-light p-4">
          <p className="text-sm text-green">{successMessage}</p>
          <Link
            href="/recipes"
            className="rounded-full bg-amber px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            View Recipes
          </Link>
        </section>
      )}

      {error && <p className="text-sm text-urgent">{error}</p>}

      {!hasItems ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
          <Refrigerator size={72} className="text-amber-muted" strokeWidth={1.5} />
          <h2 className="font-display text-2xl text-text">Your pantry is empty</h2>
          <p className="text-sm text-muted">Add your groceries to get started</p>
          <button
            type="button"
            onClick={openSheet}
            className="mt-2 flex h-12 items-center justify-center rounded-[var(--radius)] bg-amber px-6 text-base font-semibold text-white transition hover:opacity-90"
          >
            Add your first items
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {buckets.useSoon.length > 0 && (
            <section className="rounded-[var(--radius)] bg-amber-light p-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-display text-lg text-text">Use Soon</h2>
                <span className="rounded-full bg-amber px-2 py-0.5 text-xs font-semibold text-white">
                  {buckets.useSoon.length}
                </span>
              </div>
              <CategoryGroupsForItems items={buckets.useSoon} cardPropsFor={cardPropsFor} />
            </section>
          )}

          {buckets.thisMonth.length > 0 && (
            <section className="rounded-[var(--radius)] bg-surface p-4">
              <h2 className="font-display mb-3 text-lg text-text">This Month</h2>
              <CategoryGroupsForItems items={buckets.thisMonth} cardPropsFor={cardPropsFor} />
            </section>
          )}

          {buckets.wellStocked.length > 0 && (
            <section className="rounded-[var(--radius)] bg-surface p-4">
              <button
                type="button"
                onClick={() => setIsWellStockedExpanded((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg text-text">Well Stocked</h2>
                  <span className="text-xs text-muted">({buckets.wellStocked.length})</span>
                </div>
                {isWellStockedExpanded ? (
                  <ChevronUp size={20} className="text-muted" />
                ) : (
                  <ChevronDown size={20} className="text-muted" />
                )}
              </button>
              {isWellStockedExpanded && (
                <div className="mt-4">
                  <CategoryGroupsForItems items={buckets.wellStocked} cardPropsFor={cardPropsFor} />
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Floating action button */}
      <button
        type="button"
        onClick={openSheet}
        aria-label="Add items"
        className="fixed z-40 flex h-14 w-14 items-center justify-center rounded-full bg-amber text-white shadow-lg transition hover:opacity-90"
        style={{ bottom: "84px", right: "20px" }}
      >
        <Plus size={28} />
      </button>

      {/* Upload options bottom sheet */}
      {isSheetOpen && (
        <BottomSheet onClose={() => setIsSheetOpen(false)}>
          <SheetOption icon={<Camera size={22} className="text-amber" />} label="Take Photo" onClick={handleTakePhoto} />
          <SheetOption
            icon={<ImageIcon size={22} className="text-amber" />}
            label="Choose from Library"
            onClick={handleChooseFromLibrary}
          />
          <SheetOption
            icon={<Keyboard size={22} className="text-amber" />}
            label="Type Manually"
            onClick={handleTypeManually}
          />
        </BottomSheet>
      )}

      {/* Type-manually bottom sheet */}
      {isTextSheetOpen && (
        <BottomSheet onClose={() => setIsTextSheetOpen(false)}>
          <form onSubmit={handleTextSubmit} className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">Type your items</p>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="2 bananas, 1 gallon milk, ..."
              rows={4}
              disabled={isSubmitting}
              className="rounded-[var(--radius-sm)] border border-border bg-bg p-3 text-sm text-text outline-none focus:border-amber"
            />
            <button
              type="submit"
              disabled={isSubmitting || !text.trim()}
              className="flex h-12 w-full items-center justify-center rounded-[var(--radius)] bg-amber text-base font-semibold text-white transition disabled:pointer-events-none disabled:opacity-50"
            >
              {isSubmitting ? "Adding…" : "Add items"}
            </button>
          </form>
        </BottomSheet>
      )}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

function CategoryGroupsForItems({
  items,
  cardPropsFor,
}: {
  items: PantryItem[];
  cardPropsFor: (item: PantryItem) => ItemCardProps;
}) {
  const groups = groupByCategory(items);
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.category}>
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
            {group.category}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {group.items.map((item) => (
              <ItemCard key={item.id} {...cardPropsFor(item)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BottomSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        onClick={(event) => event.stopPropagation()}
        className="relative w-full rounded-t-[var(--radius)] bg-surface p-4 pb-8"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        {children}
      </div>
    </div>
  );
}

function SheetOption({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-3 text-left transition hover:bg-bg"
    >
      {icon}
      <span className="text-sm font-medium text-text">{label}</span>
    </button>
  );
}
