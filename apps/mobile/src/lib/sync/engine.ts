// Sync orchestrator. Wires the app lifecycle triggers (cold start, network
// reachable, foreground/background) to the three primitives: replay the pending
// outbox, pull post deltas, and hold the SSE nudge channel. Each primitive is
// self-serialized, so overlapping triggers are safe.
import * as Network from "expo-network";
import { AppState, type NativeEventSubscription } from "react-native";

import { checkServerSession } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { flushOutbox } from "@/lib/outbox";
import { pullChanges } from "./changes-pull";
import { connectSse, disconnectSse } from "./sse";

let started = false;
let netSub: { remove: () => void } | null = null;
let appSub: NativeEventSubscription | null = null;

async function replayAndPull(reason: string): Promise<void> {
	// Replay first so a freshly-queued submission becomes a server post before the
	// pull that would reconcile it; then pull deltas.
	try {
		await flushOutbox();
	} catch (err) {
		console.warn(`[sync] replay (${reason}) failed`, err);
	}
	try {
		await pullChanges();
	} catch (err) {
		console.warn(`[sync] pull (${reason}) failed`, err);
	}
}

// Foreground handler: a session can be revoked/expired server-side while the
// app is backgrounded, yet the Expo client keeps showing the cached session, so
// the app would sit on a dead session and only discover it via failing requests.
// On foreground, confirm with the server FIRST. On an authoritative "none",
// sign out so the route gate redirects to sign-in (and skip syncing with a dead
// cookie). A transient "unknown" (offline) proceeds optimistically, exactly as
// before — a flaky network must never sign the user out.
async function revalidateThenSync(): Promise<void> {
	const state = await checkServerSession();
	if (state === "none") {
		await signOut().catch(() => {});
		return;
	}
	connectSse(); // re-open after a background disconnect (no-op if active)
	void replayAndPull("foreground");
}

// Start the foreground sync loop. Idempotent.
export function startSync(): void {
	if (started) return;
	started = true;

	void replayAndPull("cold-start");
	connectSse();

	netSub = Network.addNetworkStateListener((state) => {
		if (state.isInternetReachable) {
			kickSync("network");
		}
	});

	appSub = AppState.addEventListener("change", (state) => {
		if (state === "active") {
			void revalidateThenSync();
		} else if (state === "background") {
			// Don't hold a socket open while suspended; the background task and the
			// next foreground both re-sync.
			disconnectSse();
		}
	});
}

export function stopSync(): void {
	if (!started) return;
	started = false;
	netSub?.remove();
	netSub = null;
	appSub?.remove();
	appSub = null;
	disconnectSse();
}

// Manual nudge (pull-to-refresh, connectivity regained). Ensures the stream is
// up and runs a replay + pull.
export function kickSync(reason: string): void {
	connectSse();
	void replayAndPull(reason);
}

// For the headless background task: replay + one delta pull, NO SSE socket
// (nothing is foregrounded to keep it alive).
export async function replayAndPullOnce(): Promise<void> {
	await replayAndPull("background-task");
}
