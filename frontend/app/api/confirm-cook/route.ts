import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callPythonApi, parsePythonApiResponse, PythonApiError } from "@/lib/python-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const recipeId = typeof body?.recipe_id === "string" ? body.recipe_id : null;
  if (!recipeId) {
    return NextResponse.json({ error: "recipe_id is required" }, { status: 400 });
  }

  const confirmed = body?.confirmed === true;
  if (confirmed && !Array.isArray(body?.plan)) {
    return NextResponse.json({ error: "plan is required to confirm a cook" }, { status: 400 });
  }

  try {
    const response = await callPythonApi("/confirm-cook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: data.user.id,
        recipe_id: recipeId,
        confirmed,
        plan: confirmed ? body.plan : undefined,
      }),
    });
    const result = await parsePythonApiResponse(response);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PythonApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("POST /api/confirm-cook failed:", error);
    return NextResponse.json({ error: "Cook confirmation failed" }, { status: 502 });
  }
}
