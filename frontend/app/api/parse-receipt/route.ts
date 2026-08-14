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

  const formData = await request.formData();
  const file = formData.get("file");
  const text = formData.get("text");

  const hasFile = file instanceof File && file.size > 0;
  const hasText = typeof text === "string" && text.trim().length > 0;

  if (!hasFile && !hasText) {
    return NextResponse.json(
      { error: "Provide a receipt file (image or PDF) or paste receipt text" },
      { status: 400 },
    );
  }

  const outgoing = new FormData();
  outgoing.append("user_id", data.user.id);
  if (hasFile) {
    outgoing.append("file", file as File);
  } else {
    outgoing.append("text", text as string);
  }

  try {
    // No Content-Type header here — fetch sets the multipart boundary
    // itself when the body is a FormData instance.
    const response = await callPythonApi("/parse-receipt", { method: "POST", body: outgoing });
    const result = await parsePythonApiResponse(response);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PythonApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Receipt parsing failed" }, { status: 502 });
  }
}
