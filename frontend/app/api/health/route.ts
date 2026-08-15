import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Debug endpoint to confirm PYTHON_API_URL/INTERNAL_API_KEY are actually
// being read in this deployment, without exposing the full secret value.
//
// Note on the masking below: `value?.slice(0, n) + "..." || "NOT SET"` looks
// right but isn't — when `value` is undefined, `undefined?.slice(...)` is
// `undefined`, and `undefined + "..."` coerces to the *string* `"undefined..."`
// (JS's `+` stringifies a non-string operand once the other side is a
// string), which is truthy — so `|| "NOT SET"` never fires. Checking
// presence before slicing avoids that.
function maskedPrefix(value: string | undefined, length: number): string {
  return value ? `${value.slice(0, length)}...` : "NOT SET";
}

export async function GET() {
  return NextResponse.json({
    python_api_url: maskedPrefix(process.env.PYTHON_API_URL, 30),
    internal_api_key_prefix: maskedPrefix(process.env.INTERNAL_API_KEY, 8),
    timestamp: new Date().toISOString(),
  });
}
