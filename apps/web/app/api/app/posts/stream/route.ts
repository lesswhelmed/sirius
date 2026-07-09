import {
  COMMENTS_CHANNEL,
  type CommentChangeNotification,
  POSTS_CHANNEL,
  type PostChangeNotification,
  REFLECTIONS_CHANNEL,
  type ReflectionChangeNotification,
  SUBMISSIONS_CHANNEL,
  type SubmissionRejectedNotification,
} from "@repo/db";
import { Client } from "pg";
import { getSessionOrNull } from "../../../../../lib/session";

// Server-Sent Events stream of change nudges for the signed-in user.
//
// The worker NOTIFYs POSTS_CHANNEL after writing a post and the web API NOTIFYs
// COMMENTS_CHANNEL / REFLECTIONS_CHANNEL after a comment or reflection write
// (see @repo/db notify.ts); this route holds a dedicated `pg` LISTEN connection
// per client and relays the owner's events for ALL channels as a single
// `change` SSE event. A nudge carries only ids/timestamps — the client reacts
// by pulling the delta feeds (../changes, ../../comments/changes and
// ../../reflections/changes), which are the real source of data.
//
// No route segment config exports here: this app uses Next 16 Cache Components,
// which rejects both `runtime` and `dynamic`. The handler is already dynamic
// because it reads the session from request headers, and it streams forever — no
// caching applies.
export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return new Response("unauthorized", { status: 401 });
  }
  const ownerId = session.user.id;

  const encoder = new TextEncoder();
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (heartbeat) clearInterval(heartbeat);
    client.removeAllListeners();
    void client.end().catch(() => {});
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (client gone) — stop relaying.
          cleanup();
        }
      };

      client.on("notification", (msg) => {
        if (
          (msg.channel !== POSTS_CHANNEL &&
            msg.channel !== COMMENTS_CHANNEL &&
            msg.channel !== REFLECTIONS_CHANNEL &&
            msg.channel !== SUBMISSIONS_CHANNEL) ||
          !msg.payload
        ) {
          return;
        }
        try {
          const payload = JSON.parse(msg.payload) as
            | PostChangeNotification
            | CommentChangeNotification
            | ReflectionChangeNotification
            | SubmissionRejectedNotification;
          // Owner-scoped: drop other users' (and unattributed bearer) events.
          if (payload.ownerId !== ownerId) return;
          // A rejected submission produces NO post, so it can't ride the generic
          // `change` re-pull (the delta feed has nothing for it). Relay a distinct
          // event carrying the submissionId so the device drops that exact row.
          if (msg.channel === SUBMISSIONS_CHANNEL) {
            enqueue(`event: submission-rejected\ndata: ${msg.payload}\n\n`);
            return;
          }
          // Posts + comments + reflections: the client treats every `change`
          // event identically (re-pull the delta feeds), so the channels relay
          // through one event type.
          enqueue(`event: change\ndata: ${msg.payload}\n\n`);
        } catch {
          // Malformed payload — ignore rather than tear down the stream.
        }
      });

      client.on("error", () => {
        // Connection dropped server-side; close so the client reconnects.
        try {
          controller.close();
        } catch {
          // already closed
        }
        cleanup();
      });

      try {
        await client.connect();
        await client.query(`LISTEN ${POSTS_CHANNEL}`);
        await client.query(`LISTEN ${COMMENTS_CHANNEL}`);
        await client.query(`LISTEN ${REFLECTIONS_CHANNEL}`);
        await client.query(`LISTEN ${SUBMISSIONS_CHANNEL}`);
      } catch (err) {
        controller.error(err);
        cleanup();
        return;
      }

      // Open the stream immediately so the client's `open` handler fires (and
      // runs its catch-up pull) without waiting for the first real event.
      enqueue(`: connected\n\n`);

      // Comment-only keepalive defeats idle-connection timeouts (proxies, the
      // browser/RN client). EventSource ignores comment lines.
      heartbeat = setInterval(() => enqueue(`: ping\n\n`), 25_000);
    },
    cancel() {
      cleanup();
    },
  });

  // Belt-and-suspenders: also tear down the pg connection if the request aborts
  // before the stream's cancel() runs.
  request.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
