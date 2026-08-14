import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Plain CRUD scoped to the calling user via RLS ("Users can update own
// row") — no model reasoning involved, so this talks to Supabase directly
// rather than through the Python API, same as the pantry-items and
// shopping-list-items PATCH routes.
export const runtime = "nodejs";

const VALID_COOKING_SKILLS = new Set(["beginner", "intermediate", "advanced"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (typeof body?.cooking_skill !== "string" || !VALID_COOKING_SKILLS.has(body.cooking_skill)) {
    return NextResponse.json(
      { error: "cooking_skill must be one of beginner, intermediate, advanced" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(body?.dietary_restrictions) ||
    !body.dietary_restrictions.every((r: unknown) => typeof r === "string")
  ) {
    return NextResponse.json(
      { error: "dietary_restrictions must be an array of strings" },
      { status: 400 },
    );
  }
  if (typeof body?.max_cooking_time !== "number" || !Number.isFinite(body.max_cooking_time)) {
    return NextResponse.json(
      { error: "max_cooking_time must be a number" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("users")
    .update({
      cooking_skill: body.cooking_skill,
      dietary_restrictions: body.dietary_restrictions,
      max_cooking_time: Math.round(body.max_cooking_time),
      onboarding_complete: true,
    })
    .eq("id", data.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
