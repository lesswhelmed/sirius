// Session-authed chat: streams a grounded, cited answer over the viewer's own
// posts (and friends' when the model asks) as a standard AI SDK UI message
// stream (consumed by useChat on mobile). No route-segment config — reading the
// session already makes the handler dynamic (Next 16 Cache Components).
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import { runChatTurn } from "../../../../lib/chat/agent";
import {
  chatBodySchema,
  makeToolOutputTrimmer,
  toModelMessages,
  type ChatSource,
} from "../../../../lib/chat/ui-stream";
import { rateLimit } from "../../../../lib/rate-limit";
import { getSessionOrNull } from "../../../../lib/session";

// Each chat turn is a paid Gemini call plus tool round-trips — keep caps tight.
const PER_USER_MAX = 30;
const GLOBAL_MAX = 120;
const WINDOW_MS = 5 * 60 * 1000;

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return Response.json({ error, ...extra }, { status });
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) return jsonError(401, "unauthorized");

  const perUser = rateLimit(`chat:${session.user.id}`, PER_USER_MAX, WINDOW_MS);
  if (!perUser.ok)
    return jsonError(429, "rate limited", {
      retryAfterMs: perUser.retryAfterMs,
    });
  const global = rateLimit("chat:global", GLOBAL_MAX, WINDOW_MS);
  if (!global.ok)
    return jsonError(429, "rate limited", {
      retryAfterMs: global.retryAfterMs,
    });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = chatBodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, "expected { messages: [...] }");

  const messages = toModelMessages(parsed.data.messages);
  if (messages.length === 0) return jsonError(400, "no text in messages");
  const viewerId = session.user.id;

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // Rewrite the same part (stable id) as the agent opens posts, so the
      // client's Sources card fills in live and ends complete.
      const sources: ChatSource[] = [];
      const run = runChatTurn({
        viewerId,
        messages,
        abortSignal: request.signal,
        onPostOpened: (post) => {
          if (sources.some((s) => s.slug === post.slug)) return;
          sources.push(post);
          writer.write({
            type: "data-source-posts",
            id: "sources",
            data: [...sources],
          });
        },
      });
      writer.merge(
        run.stream.toUIMessageStream().pipeThrough(makeToolOutputTrimmer()),
      );
    },
    onError: (err) => (err instanceof Error ? err.message : "chat failed"),
  });

  return createUIMessageStreamResponse({ stream });
}
