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
  const requestText = typeof body?.request === "string" ? body.request.trim() : "";
  if (!requestText) {
    return NextResponse.json({ error: "request text is required" }, { status: 400 });
  }

  try {
    const response = await callPythonApi("/custom-recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: data.user.id, request: requestText }),
    });
    const result = await parsePythonApiResponse(response);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PythonApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Recipe recommendation failed" }, { status: 502 });
  }
}
