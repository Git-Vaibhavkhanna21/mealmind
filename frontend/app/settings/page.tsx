import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center gap-6 bg-bg px-6 pt-16 text-center">
      <p className="text-lg text-text">{user.email}</p>
      <div className="w-full max-w-[320px]">
        <SignOutButton />
      </div>
    </main>
  );
}
