import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callPythonApi, parsePythonApiResponse, PythonApiError } from "@/lib/python-api";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const response = await callPythonApi("/shopping-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: data.user.id }),
    });
    const result = await parsePythonApiResponse(response);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PythonApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("POST /api/shopping-list failed:", error);
    return NextResponse.json({ error: "Shopping list generation failed" }, { status: 502 });
  }
}
