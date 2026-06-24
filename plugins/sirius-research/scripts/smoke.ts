// Blackbox smoke test for the sirius-research plugin's MCP surface.
//
// Connects to the sirius-corpus MCP server exactly as the plugin's .mcp.json
// does (Streamable HTTP + Authorization: Bearer <key>), then exercises ALL 9
// tools, BOTH resources, and lists the 3 prompts, asserting the structured
// input/output contract documented in
// skills/sirius-research/references/tool-catalog.md. Also runs an auth-negative
// check (bad key must be rejected).
//
// Usage (from repo root, resolves @modelcontextprotocol/sdk via hoisted deps):
//   SIRIUS_MCP_API_KEY=<plaintext-key> bun run plugins/sirius-research/scripts/smoke.ts
//   (optional) SIRIUS_MCP_URL=http://localhost:3005/mcp
//
// Mint a key from /settings (API Keys) in the web app or POST /api/app/api-keys.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_BASE =
  process.env.SIRIUS_MCP_URL ?? process.env.MCP_SMOKE_URL ?? "http://localhost:3005/mcp";
const KEY = process.env.SIRIUS_MCP_API_KEY ?? process.env.MCP_SMOKE_KEY;

const EXPECTED_TOOLS = [
  "search_posts",
  "full_text_search",
  "semantic_search",
  "get_post",
  "list_categories",
  "browse_category",
  "list_projects",
  "browse_project",
  "classify_text",
];
const EXPECTED_PROMPTS = ["research_topic", "cite_from_corpus", "summarize_category"];

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function firstText(result: { content?: { type: string; text?: string }[] }): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "";
}
function asJson(result: unknown): Record<string, unknown> {
  try {
    return JSON.parse(firstText(result as never) || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function connect(key: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(URL_BASE), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: "sirius-research-plugin-smoke", version: "0.1.0" });
  return client.connect(transport).then(() => client);
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error("set SIRIUS_MCP_API_KEY=<plaintext api key>");
    process.exit(2);
  }
  console.log(`# sirius-research plugin smoke → ${URL_BASE}\n`);

  // --- Auth negative: a bogus key must be rejected (no corpus access). ---
  console.log("auth (negative):");
  try {
    const bad = await connect("totally-invalid-key-0000");
    const r = await bad.callTool({ name: "full_text_search", arguments: { query: "x", limit: 1 } });
    const j = asJson(r);
    // Either connect/list throws, or the call returns no items for a bad key.
    check("bad key yields no corpus access", !Array.isArray(j.items) || (j.items as []).length === 0,
      "bad key returned items");
    await bad.close();
  } catch {
    check("bad key rejected (threw)", true);
  }

  // --- Authenticated surface ---
  const client = await connect(KEY);

  console.log("\ndiscovery:");
  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const t of EXPECTED_TOOLS) check(`tool present: ${t}`, tools.includes(t));
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  for (const p of EXPECTED_PROMPTS) check(`prompt present: ${p}`, prompts.includes(p));
  const resources = await client.listResources();
  check("resources/list returns owner posts", Array.isArray(resources.resources));

  console.log("\nsearch tools:");
  const fts = asJson(await client.callTool({ name: "full_text_search", arguments: { query: "the", limit: 5 } }));
  check("full_text_search → {items,nextCursor}", Array.isArray(fts.items) && "nextCursor" in fts);
  const sem = asJson(await client.callTool({ name: "semantic_search", arguments: { query: "what have I been thinking about", limit: 5 } }));
  check("semantic_search → {items}", Array.isArray(sem.items));
  const sp = asJson(await client.callTool({ name: "search_posts", arguments: { limit: 5 } }));
  check("search_posts → {items,nextCursor}", Array.isArray(sp.items) && "nextCursor" in sp);

  console.log("\ntaxonomy + projects:");
  const cats = asJson(await client.callTool({ name: "list_categories", arguments: {} }));
  check("list_categories → {tree}", Array.isArray(cats.tree));
  const projs = asJson(await client.callTool({ name: "list_projects", arguments: {} }));
  check("list_projects → {projects}", Array.isArray(projs.projects));
  const cls = asJson(await client.callTool({ name: "classify_text", arguments: { text: "a note about productivity and focus", topK: 3 } }));
  check("classify_text → {categories}", Array.isArray(cls.categories) || "categories" in cls);

  // Drill into the first category node, if any.
  const firstCat = (cats.tree as { path?: string }[])?.[0]?.path;
  if (firstCat) {
    const bc = asJson(await client.callTool({ name: "browse_category", arguments: { path: firstCat, limit: 5 } }));
    check("browse_category → {category,items,nextCursor}", "category" in bc && Array.isArray(bc.items));
  } else {
    console.log("  skip browse_category — no categories for this user");
  }
  const firstProj = (projs.projects as { id?: string }[])?.[0]?.id;
  if (firstProj) {
    const bp = asJson(await client.callTool({ name: "browse_project", arguments: { projectId: firstProj, limit: 5 } }));
    check("browse_project → {project,items,nextCursor}", "project" in bp && Array.isArray(bp.items));
  } else {
    console.log("  skip browse_project — no projects for this user");
  }

  console.log("\npost reading:");
  const slug = (fts.items as { slug?: string }[])?.[0]?.slug ?? (sp.items as { slug?: string }[])?.[0]?.slug;
  if (slug) {
    const post = asJson(await client.callTool({ name: "get_post", arguments: { slug } }));
    check("get_post → {slug,title,content}", post.slug === slug && typeof post.title === "string" && "content" in post);
    const res = await client.readResource({ uri: `sirius://post/${slug}` });
    const c = res.contents[0];
    const text = c && "text" in c && typeof c.text === "string" ? c.text : "";
    check("sirius://post/{slug} → markdown", text.length > 0);
  } else {
    console.log("  skip get_post/resource — no posts for this user (seed the reviewer corpus)");
  }

  await client.close();
  console.log(`\n${failures === 0 ? "SMOKE OK" : `SMOKE FAILED (${failures} failing checks)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke ERROR:", err);
  process.exit(1);
});
