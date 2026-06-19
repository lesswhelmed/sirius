import { POSTS_CHANNEL, type PostChangeNotification } from "@repo/db";
import { Client } from "pg";
import { getSessionOrNull } from "../../../../../lib/session";

// Server-Sent Events stream of post-change nudges for the signed-in user.
//
// The worker NOTIFYs POSTS_CHANNEL after writing a post (see @repo/db notify.ts);
// this route holds a dedicated `pg` LISTEN connection per client and relays the
// owner's events as SSE. A nudge carries only ids/timestamps — the client reacts
// by pulling the delta feed (../changes), which is the real source of post data.
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
				if (msg.channel !== POSTS_CHANNEL || !msg.payload) return;
				try {
					const payload = JSON.parse(msg.payload) as PostChangeNotification;
					// Owner-scoped: drop other users' (and unattributed bearer) posts.
					if (payload.ownerId !== ownerId) return;
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
