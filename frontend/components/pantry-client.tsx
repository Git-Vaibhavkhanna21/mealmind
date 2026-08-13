"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

type PantryItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  purchase_date: string;
  expiry_date: string | null;
  is_depleted: boolean;
};

export function PantryClient({ initialItems }: { initialItems: PantryItem[] }) {
  const [items, setItems] = useState<PantryItem[]>(initialItems);
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [editIsDepleted, setEditIsDepleted] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function submitFormData(formData: FormData) {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/parse-receipt", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to parse receipt");
      }
      setItems((current) => [...(result.items as PantryItem[]), ...current]);
      setText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse receipt");
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
  }

  async function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    const formData = new FormData();
    formData.append("text", text);
    await submitFormData(formData);
  }

  function startEditing(item: PantryItem) {
    setEditingItemId(item.id);
    setEditQuantity(item.quantity === null ? "" : String(item.quantity));
    setEditIsDepleted(item.is_depleted);
    setEditError(null);
  }

  function cancelEditing() {
    setEditingItemId(null);
    setEditError(null);
  }

  async function saveEditing(itemId: string) {
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/pantry-items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: editQuantity.trim() === "" ? null : Number(editQuantity),
          is_depleted: editIsDepleted,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to update item");
      }
      setItems((current) =>
        current.map((item) => (item.id === itemId ? (result.item as PantryItem) : item)),
      );
      setEditingItemId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setIsSavingEdit(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <div>
          <h2 className="font-medium">Add items from a receipt</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Upload a photo or PDF of a receipt — items are extracted and
            expiry dates are estimated automatically.
          </p>
        </div>

        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50 has-disabled:pointer-events-none has-disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800">
          {isSubmitting ? "Parsing…" : "Upload receipt (image or PDF)"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={isSubmitting}
            onChange={handleFileChange}
          />
        </label>

        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-500">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          or paste receipt text
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>

        <form onSubmit={handleTextSubmit} className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="2 bananas, 1 gallon milk, ..."
            rows={4}
            disabled={isSubmitting}
            className="rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={isSubmitting || !text.trim()}
            className="self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isSubmitting ? "Parsing…" : "Add items"}
          </button>
        </form>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">
          {items.length} item{items.length === 1 ? "" : "s"} in your pantry
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No pantry items yet — upload a receipt to get started.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {items.map((item) =>
              editingItemId === item.id ? (
                <li key={item.id} className="flex flex-col gap-2 py-3">
                  <p className="font-medium capitalize">{item.name}</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      Quantity
                      <input
                        type="number"
                        value={editQuantity}
                        onChange={(event) => setEditQuantity(event.target.value)}
                        className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editIsDepleted}
                        onChange={(event) => setEditIsDepleted(event.target.checked)}
                      />
                      Depleted
                    </label>
                  </div>
                  {editError && <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveEditing(item.id)}
                      disabled={isSavingEdit}
                      className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      {isSavingEdit ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={isSavingEdit}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ) : (
                <li key={item.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium capitalize">
                      {item.name}
                      {item.is_depleted && (
                        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          Depleted
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {[item.quantity, item.unit].filter(Boolean).join(" ") || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-zinc-500 dark:text-zinc-500">
                      {item.expiry_date ? `Expires ${item.expiry_date}` : "No expiry estimate"}
                    </p>
                    <button
                      type="button"
                      onClick={() => startEditing(item)}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                    >
                      Edit
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
