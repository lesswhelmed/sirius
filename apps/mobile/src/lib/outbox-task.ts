// Background sync for the offline-first store. The OS wakes the app
// periodically (BGTaskScheduler on iOS, WorkManager on Android) so notes
// captured offline can reach the server — and so the local mirror catches up on
// new posts — even if the user doesn't reopen the app after connectivity
// returns. It replays the pending outbox and pulls post deltas, but does NOT
// open the SSE socket (nothing is foregrounded to keep it alive).
//
// Honest limits: both platforms schedule opportunistically (battery/network
// heuristics, >=15 min between runs, no exact timing), and iOS never runs
// background tasks after the user force-quits the app. The foreground
// triggers in _layout.tsx (cold start, reconnect, foreground, queue poll)
// remain the primary delivery path — this is a best-effort extra.
//
// defineTask must run at module global scope on every launch, including
// headless background launches — _layout.tsx imports this module for its
// side effect.
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { replayAndPullOnce } from "@/lib/sync/engine";

export const OUTBOX_TASK = "outbox-flush";

TaskManager.defineTask(OUTBOX_TASK, async () => {
	try {
		await replayAndPullOnce();
		return BackgroundTask.BackgroundTaskResult.Success;
	} catch {
		return BackgroundTask.BackgroundTaskResult.Failed;
	}
});

// Registers the periodic task; idempotent across launches. minimumInterval is
// in minutes and is a floor, not a schedule.
export async function registerOutboxTask(): Promise<void> {
	try {
		if (await TaskManager.isTaskRegisteredAsync(OUTBOX_TASK)) {
			return;
		}
		await BackgroundTask.registerTaskAsync(OUTBOX_TASK, {
			minimumInterval: 15,
		});
	} catch (err) {
		// Background flushing is best-effort; never let registration failures
		// (e.g. unsupported platform/simulator) affect the app.
		console.warn(
			`[outbox] background task registration failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}
