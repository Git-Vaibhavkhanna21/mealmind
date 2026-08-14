import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Python agents/workflows/mcp_servers this app shells out to (see
  // app/api/*/route.ts) live one level up, outside this Next.js project.
  // Turbopack/webpack's output file tracing only ever includes files under
  // the tracing root (this project directory) unless that root is widened —
  // pinning it here to this directory (rather than leaving it to
  // auto-detection, which walks up looking for a workspace lockfile) keeps
  // that boundary explicit, so the Python side can never get pulled into a
  // serverless function's build trace.
  //
  // (outputFileTracingExcludes can't help here even as a belt-and-suspenders
  // measure — Turbopack rejects "../" patterns in its exclude globs since
  // they'd navigate outside the project root, which is exactly the
  // scope those files are already excluded from by default.)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
