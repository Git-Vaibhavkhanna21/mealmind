import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Uses the filesystem and spawns the Python workflow as a subprocess, so
// this route needs the Node runtime rather than the edge runtime.
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

// frontend/ is a subdirectory of the repo; the Python workflow and its venv
// live at the repo root, one level up from process.cwd() (`next dev`/`next
// start` always run with frontend/ as cwd).
const REPO_ROOT = path.resolve(process.cwd(), "..");
const PYTHON_BIN = path.join(REPO_ROOT, ".venv", "bin", "python3");
const WORKFLOW_SCRIPT = path.join(REPO_ROOT, "workflows", "receipt_parsing.py");

const IMAGE_EXTENSIONS_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const ALLOWED_FILE_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function resolveFileExtension(file: File): string | null {
  if (file.type === "application/pdf") return ".pdf";
  if (file.type in IMAGE_EXTENSIONS_BY_MIME_TYPE) {
    return IMAGE_EXTENSIONS_BY_MIME_TYPE[file.type];
  }
  const fromName = path.extname(file.name).toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.has(fromName) ? fromName : null;
}

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

  let tempDir: string | null = null;
  try {
    const args = ["--user-id", data.user.id];

    if (hasFile) {
      const uploaded = file as File;
      const extension = resolveFileExtension(uploaded);
      if (!extension) {
        return NextResponse.json(
          { error: "Unsupported file type — upload an image (jpg/png/gif/webp) or PDF" },
          { status: 400 },
        );
      }

      tempDir = await mkdtemp(path.join(tmpdir(), "mealmind-receipt-"));
      const filePath = path.join(tempDir, `receipt${extension}`);
      await writeFile(filePath, Buffer.from(await uploaded.arrayBuffer()));

      args.push(extension === ".pdf" ? "--pdf" : "--image", filePath);
    } else {
      args.push("--text", text as string);
    }

    const { stdout } = await execFileAsync(PYTHON_BIN, [WORKFLOW_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });

    const result = JSON.parse(stdout);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr)
        : error instanceof Error
          ? error.message
          : "Receipt parsing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
