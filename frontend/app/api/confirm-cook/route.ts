import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const AGENT_SCRIPT = path.join(REPO_ROOT, "agents", "pantry_deductor.py");

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

  let tempDir: string | null = null;
  try {
    if (!confirmed) {
      // Preview step: build the deduction plan for the user to review.
      const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [AGENT_SCRIPT, "--recipe-id", recipeId, "--user-id", data.user.id],
        { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 },
      );
      return NextResponse.json(JSON.parse(stdout));
    }

    if (!Array.isArray(body?.plan)) {
      return NextResponse.json({ error: "plan is required to confirm a cook" }, { status: 400 });
    }

    // Confirm step: apply the plan the user reviewed (echoed back in the
    // request) — subtracts quantities, flips is_depleted, records the cook.
    tempDir = await mkdtemp(path.join(tmpdir(), "mealmind-deduction-"));
    const planPath = path.join(tempDir, "plan.json");
    await writeFile(planPath, JSON.stringify(body.plan));

    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [
        AGENT_SCRIPT,
        "--recipe-id",
        recipeId,
        "--user-id",
        data.user.id,
        "--apply",
        "--plan-file",
        planPath,
      ],
      { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 },
    );
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr)
        : error instanceof Error
          ? error.message
          : "Cook confirmation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
