import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Spawns the Python agent as a subprocess, so this route needs the Node
// runtime rather than the edge runtime.
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

// frontend/ is a subdirectory of the repo; the Python agent and its venv
// live at the repo root, one level up from process.cwd() (`next dev`/`next
// start` always run with frontend/ as cwd).
const REPO_ROOT = path.resolve(process.cwd(), "..");
const PYTHON_BIN = path.join(REPO_ROOT, ".venv", "bin", "python3");
const AGENT_SCRIPT = path.join(REPO_ROOT, "agents", "meal_recommender.py");

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let customRequest: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.request === "string" && body.request.trim()) {
      customRequest = body.request.trim();
    }
  } catch {
    // No body (or non-JSON body) means the default pantry-driven
    // recommendations were requested, not a custom recipe.
  }

  const args = [AGENT_SCRIPT, "--user-id", data.user.id];
  if (customRequest) {
    args.push("--custom", customRequest);
  }

  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, args, {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });
    const recipes = JSON.parse(stdout);
    return NextResponse.json({ recipes });
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr)
        : error instanceof Error
          ? error.message
          : "Recipe recommendation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
