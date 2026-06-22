// Standalone Bun HTTP service exposing each user's post corpus over MCP
// (Streamable HTTP, STATELESS). Run with `bun run start`. Per request:
//   1. Verify `Authorization: Bearer <key>` → userId (else 401).
//   2. Build a FRESH McpServer bound to that userId.
//   3. Connect it to a stateless WebStandard transport, handle the one request,
//      return the Response, then dispose both. No shared per-user state.
// The repo-root `.env` is auto-loaded by Bun via the `.env` symlink in this
// app dir (DATABASE_URL, GEMINI_API_KEY, BETTER_AUTH_SECRET, MCP_PORT).
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { verifyKey } from "./auth";
import { getPort, log } from "./config";
import { buildServerForUser } from "./server";

const port = getPort();

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      // Advertise the scheme without revealing whether a key exists.
      "www-authenticate": 'Bearer realm="sirius-mcp"',
    },
  });
}

async function handleMcp(request: Request): Promise<Response> {
  const verified = await verifyKey(request);
  if (!verified) {
    return unauthorized();
  }

  const server = buildServerForUser(verified.userId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode — each request is independent; no session map.
    sessionIdGenerator: undefined,
    // Simple JSON request/response (no SSE streams) — fine for read-only tools.
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (err) {
    log("error", "request failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ error: "internal error" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  } finally {
    // Dispose per-request state so no userId binding outlives the request.
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

const httpServer = Bun.serve({
  port,
  idleTimeout: 120,
  async fetch(request) {
    const url = new URL(request.url);

    // Unauthenticated liveness probe for PM2 / Caddy health checks.
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    // The MCP Streamable HTTP endpoint. Hosts POST JSON-RPC here (and may GET
    // for SSE / DELETE to end a session — the transport handles all verbs).
    if (url.pathname === "/" || url.pathname === "/mcp") {
      return handleMcp(request);
    }

    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  },
});

log("info", `sirius-mcp listening on :${httpServer.port}`);

function shutdown(signal: string): void {
  log("info", `received ${signal}, shutting down`);
  httpServer.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
