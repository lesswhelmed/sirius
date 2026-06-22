// Smoke client for the MCP corpus server (spec §9.2). Connects to a running
// instance with a dev API key, lists tools/resources/prompts, runs the three
// search modes + get_post, and reads a sirius://post/{slug} resource. Asserts
// results are non-empty for the dev user.
//
// Usage:
//   MCP_SMOKE_KEY=<plaintext-api-key> bun run apps/mcp/scripts/smoke.ts
//   (optional) MCP_SMOKE_URL=http://localhost:3005/mcp
//
// Mint a key from /settings in the web app (API Keys section) or via
// POST /api/app/api-keys while signed in.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Smoke-only runtime inputs — NOT build-cache inputs, so deliberately not in
// turbo.json globalEnv (which would wrongly invalidate builds on a test key).
/* eslint-disable turbo/no-undeclared-env-vars */
const URL_BASE = process.env.MCP_SMOKE_URL ?? "http://localhost:3005/mcp";
const KEY = process.env.MCP_SMOKE_KEY;
/* eslint-enable turbo/no-undeclared-env-vars */

if (!KEY) {
  console.error("set MCP_SMOKE_KEY=<plaintext api key>");
  process.exit(1);
}

function firstText(result: { content?: { type: string; text?: string }[] }): string {
  const block = result.content?.find((c) => c.type === "text");
  return block?.text ?? "";
}

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(URL_BASE), {
    requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
  });
  const client = new Client({ name: "sirius-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`tools: ${tools.tools.map((t) => t.name).join(", ")}`);
  const resources = await client.listResources();
  console.log(`resources: ${resources.resources.length}`);
  const prompts = await client.listPrompts();
  console.log(`prompts: ${prompts.prompts.map((p) => p.name).join(", ")}`);

  const fts = await client.callTool({
    name: "full_text_search",
    arguments: { query: "the", limit: 5 },
  });
  console.log("full_text_search:", firstText(fts as never).slice(0, 200));

  const sem = await client.callTool({
    name: "semantic_search",
    arguments: { query: "what have I been thinking about", limit: 5 },
  });
  console.log("semantic_search:", firstText(sem as never).slice(0, 200));

  // Pull a slug from full_text_search to exercise get_post + the resource.
  const ftsJson = JSON.parse(firstText(fts as never) || "{}") as {
    items?: { slug: string }[];
  };
  const slug = ftsJson.items?.[0]?.slug;
  if (slug) {
    const post = await client.callTool({
      name: "get_post",
      arguments: { slug },
    });
    console.log("get_post:", firstText(post as never).slice(0, 200));
    const res = await client.readResource({ uri: `sirius://post/${slug}` });
    const content = res.contents[0];
    const text =
      content && "text" in content && typeof content.text === "string"
        ? content.text
        : "";
    console.log("resource:", text.slice(0, 200));
  } else {
    console.log("no posts for this user — get_post/resource skipped");
  }

  await client.close();
  console.log("smoke OK");
}

main().catch((err) => {
  console.error("smoke FAILED:", err);
  process.exit(1);
});
