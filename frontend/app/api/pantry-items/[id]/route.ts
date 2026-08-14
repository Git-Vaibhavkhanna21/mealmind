import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callPythonApi, parsePythonApiResponse, PythonApiError } from "@/lib/python-api";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const updates: Record<string, unknown> = {};
  if (body?.quantity === null || typeof body?.quantity === "number") {
    updates.quantity = body.quantity;
  }
  if (typeof body?.is_depleted === "boolean") {
    updates.is_depleted = body.is_depleted;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const response = await callPythonApi(`/pantry-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: data.user.id, ...updates }),
    });
    const result = await parsePythonApiResponse(response);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PythonApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to update pantry item" }, { status: 502 });
  }
}
