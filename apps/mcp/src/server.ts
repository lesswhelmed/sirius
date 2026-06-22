// Build a FRESH McpServer bound to one verified userId, with all tools,
// resources, and prompts registered (each closing over that userId). This is
// the safest multi-tenant posture (spec §3): no shared server/session state can
// leak one user's userId into another user's request. The caller connects it to
// a stateless transport, handles ONE request, then disposes both.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerPrompts } from "./prompts/index";
import { registerResources } from "./resources/index";
import { registerTools } from "./tools/index";

export function buildServerForUser(userId: string): McpServer {
  const server = new McpServer(
    { name: "sirius-corpus", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        "Read-only access to a single Sirius user's post corpus (an 'LLM " +
        "wiki'). Search by structured filter (search_posts), keyword " +
        "(full_text_search), or meaning (semantic_search); navigate the topic " +
        "taxonomy (list_categories/browse_category) and projects " +
        "(list_projects/browse_project); read full posts with get_post or the " +
        "sirius://post/{slug} resource. All results are scoped to this user.",
    },
  );

  registerTools(server, userId);
  registerResources(server, userId);
  registerPrompts(server);

  return server;
}
