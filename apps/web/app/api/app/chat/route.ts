// Session-authed SSE chat: streams a grounded, cited answer over the viewer's own
// posts (and friends' when the model asks). Hand-rolled SSE per repo convention
// (see app/api/app/posts/stream/route.ts). No route-segment config — reading the
// session already makes the handler dynamic (Next 16 Cache Components).
import type { ModelMessage } from "ai";

import { runChatTurn } from "../../../../lib/chat/agent";
import { chatBodySchema, encodeFrame, type ChatSource } from "../../../../lib/chat/sse";
import { rateLimit } from "../../../../lib/rate-limit";
import { getSessionOrNull } from "../../../../lib/session";

// Each chat turn is a paid Gemini call plus tool round-trips — keep caps tight.
const PER_USER_MAX = 30;
const GLOBAL_MAX = 120;
const WINDOW_MS = 5 * 60 * 1000;

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status });
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) return jsonError(401, "unauthorized");

  const perUser = rateLimit(`chat:${session.user.id}`, PER_USER_MAX, WINDOW_MS);
  if (!perUser.ok)
    return jsonError(429, "rate limited", { retryAfterMs: perUser.retryAfterMs });
  const global = rateLimit("chat:global", GLOBAL_MAX, WINDOW_MS);
  if (!global.ok)
    return jsonError(429, "rate limited", { retryAfterMs: global.retryAfterMs });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = chatBodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, "expected { messages: [...] }");

  const messages = parsed.data.messages as ModelMessage[];
  const viewerId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Guard enqueue: if the client disconnects mid-stream the controller is
      // torn down, and a raw enqueue throws — which would escape the catch below
      // (it also calls send) into an unhandled rejection. Swallow it and stop
      // emitting (matches app/api/app/posts/stream/route.ts).
      const send = (line: string) => {
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          // controller already closed/errored (client aborted) — drop the frame.
        }
      };
      try {
        const run = runChatTurn({
          viewerId,
          messages,
          abortSignal: request.signal,
        });
        for await (const delta of run.stream.textStream) {
          send(encodeFrame({ t: "token", v: delta }));
        }
        const sources: ChatSource[] = run.opened.map((p) => ({
          serverId: p.slug,
          slug: p.slug,
          title: p.title,
          excerpt: p.excerpt,
        }));
        send(encodeFrame({ t: "sources", v: sources }));
        send(encodeFrame({ t: "done" }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "chat failed";
        send(encodeFrame({ t: "error", v: msg }));
      } finally {
        try {
          controller.close();
        } catch {
          // already closed (client aborted mid-stream) — nothing to do.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
