// Server-driven removal of optimistic rows whose submission was REJECTED before
// any post existed — today: the content-safety gate flagged the content. There's
// no Post to pull (the delta feed has nothing), so this is its own tiny path:
//   • SSE fast-path: the worker sends the resolved reconciliation key →
//     handleRejectedNudge removes the matching local row instantly.
//   • Queue-poll baseline (offline-tolerant): the 5s queue poll already returns
//     "flagged" submissions; reconcileRejectedSubmissions drops their local rows.
// Both converge on removeLocalBySubmissionId, which is idempotent — once the row
// is gone, re-polling removes nothing and shows nothing, so the neutral notice
// fires exactly once (and only when the user actually had a visible row).
import type { IngestSubmission } from "@repo/db";
import { Alert } from "react-native";

import { removeLocalBySubmissionId } from "./writes";

// Mirror of the worker's sourceRecordIdFor: the key stored in posts.submissionId.
// Image batch → "batch:<batchId>"; everything else → the submission id.
function reconKey(item: Pick<IngestSubmission, "id" | "kind" | "batchId">): string {
  if (item.kind === "image" && item.batchId) return `batch:${item.batchId}`;
  return item.id;
}

// Deliberately neutral — no accusation, no policy detail (avoids tipping off bad
// actors and invites no dispute). The admin, not the user, gets the real signal.
function showNeutralNotice(): void {
  Alert.alert(
    "Couldn't be processed",
    "We weren't able to process this item, so it wasn't saved.",
  );
}

export async function reconcileRejectedSubmissions(
  items: IngestSubmission[],
): Promise<void> {
  const rejected = items.filter((s) => s.status === "flagged");
  if (rejected.length === 0) return;
  let removedAny = false;
  for (const item of rejected) {
    const removed = await removeLocalBySubmissionId(reconKey(item));
    if (removed > 0) removedAny = true;
  }
  if (removedAny) showNeutralNotice();
}

export async function handleRejectedNudge(submissionId: string): Promise<void> {
  const removed = await removeLocalBySubmissionId(submissionId);
  if (removed > 0) showNeutralNotice();
}
