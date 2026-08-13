import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  const { user } = data;

  const { data: existingUser } = await supabase
    .from("users")
    .select("onboarding_complete")
    .eq("id", user.id)
    .maybeSingle();

  if (!existingUser) {
    await supabase.from("users").insert({
      id: user.id,
      email: user.email,
      google_id: user.user_metadata?.provider_id ?? user.user_metadata?.sub,
    });
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  if (!existingUser.onboarding_complete) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  return NextResponse.redirect(`${origin}/pantry`);
}
