import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Plain CRUD scoped to the calling user — no model reasoning involved, so
// like the pantry-items PATCH route this updates Supabase directly through
// the per-user (RLS-scoped) server client instead of shelling out to Python.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.purchased !== "boolean") {
    return NextResponse.json({ error: "purchased (boolean) is required" }, { status: 400 });
  }

  // RLS ("Users can update own shopping list items") already scopes this
  // to the caller, but filtering on user_id too keeps the intent explicit.
  const { data: updated, error } = await supabase
    .from("shopping_list_items")
    .update({ purchased: body.purchased })
    .eq("id", id)
    .eq("user_id", data.user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: updated });
}
