// Shared client for the FastAPI service (api/main.py) that every route
// touching a Python agent talks to over HTTP — see DEPLOYMENT.md for why
// this exists instead of spawning a local Python subprocess (short version:
// Vercel's serverless runtime has no Python interpreter to spawn one into).

const PYTHON_API_URL = process.env.PYTHON_API_URL;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

export class PythonApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PythonApiError";
    this.status = status;
  }
}

/**
 * Calls the FastAPI service, attaching the shared internal API key header.
 * Pass a `Content-Type` header yourself for JSON bodies; leave it unset for
 * FormData bodies so fetch can set the multipart boundary itself.
 */
export async function callPythonApi(path: string, init: RequestInit = {}): Promise<Response> {
  if (!PYTHON_API_URL) {
    throw new PythonApiError("PYTHON_API_URL is not configured", 500);
  }

  const headers = new Headers(init.headers);
  if (INTERNAL_API_KEY) {
    headers.set("X-Internal-Api-Key", INTERNAL_API_KEY);
  }

  return fetch(`${PYTHON_API_URL}${path}`, { ...init, headers });
}

/** Parses a callPythonApi response, throwing PythonApiError on non-2xx. */
export async function parsePythonApiResponse<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) {
    throw new PythonApiError(result?.detail ?? "Python API request failed", response.status);
  }
  return result as T;
}
