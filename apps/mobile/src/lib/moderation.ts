// Report / block moderation actions (App Store Guideline 1.2 UGC safety),
// shared by the Friends feed rows, the peer post-detail screen, and the
// friend-catalog screen. Uses native ActionSheetIOS on iOS with Alert.alert
// fallbacks on Android — deliberately NOT the Sheet component: Sheet is an RN
// Modal and the app has a strict one-visible-Modal rule, while these actions
// can be triggered from arbitrary screens (some of which already host a Modal).
//
// Server contracts:
//   POST   /api/app/posts/[slug]/report        { reason, note? } -> { ok: true }
//   POST   /api/app/users/[idOrHandle]/block   { postSlug? }     -> { ok: true }
//   DELETE /api/app/users/[idOrHandle]/block                      -> unblock
// (The block route's dynamic segment is named [handle] server-side for
// Next.js param-name reasons, but resolves the value as user id FIRST, then
// handle — we always send the id, which the feed/post payloads expose.)
import { ActionSheetIOS, Alert, Platform } from "react-native";

import { apiPostJson } from "@/lib/api";

export type ReportReason = "OBJECTIONABLE" | "ABUSE" | "SPAM" | "OTHER";

// Ordered list drives the iOS action sheet; the Android fallback (which can
// only render three Alert buttons) spells the same reasons out literally below.
const REPORT_REASONS: readonly { reason: ReportReason; label: string }[] = [
  { reason: "OBJECTIONABLE", label: "Objectionable content" },
  { reason: "ABUSE", label: "Abusive or harassing" },
  { reason: "SPAM", label: "Spam" },
  { reason: "OTHER", label: "Something else" },
];

export type PostAuthor = {
  id: string;
  name: string | null;
  handle: string | null;
};

function authorLabel(author: Pick<PostAuthor, "name" | "handle">): string {
  return author.handle ? `@${author.handle}` : (author.name ?? "this user");
}

async function submitReport(slug: string, reason: ReportReason): Promise<void> {
  try {
    await apiPostJson<{ ok: boolean }>(
      `/api/app/posts/${encodeURIComponent(slug)}/report`,
      { reason },
    );
    Alert.alert("Reported", "We review reports within 24 hours.");
  } catch {
    Alert.alert("Couldn’t report", "Check your connection and try again.");
  }
}

// Second step of the report flow: pick one of the four reasons.
function pickReportReason(slug: string): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Report post",
        message: "Why are you reporting this post?",
        options: [...REPORT_REASONS.map((r) => r.label), "Cancel"],
        cancelButtonIndex: REPORT_REASONS.length,
      },
      (index) => {
        const choice = REPORT_REASONS[index];
        if (choice) void submitReport(slug, choice.reason);
      },
    );
    return;
  }
  // Android Alert renders at most three buttons, so the four reasons are split
  // across two chained alerts. Tapping outside cancels either step.
  Alert.alert(
    "Report post",
    "Why are you reporting this post?",
    [
      {
        text: "Objectionable content",
        onPress: () => void submitReport(slug, "OBJECTIONABLE"),
      },
      {
        text: "Abusive or harassing",
        onPress: () => void submitReport(slug, "ABUSE"),
      },
      {
        text: "More options…",
        onPress: () => {
          Alert.alert(
            "Report post",
            "Why are you reporting this post?",
            [
              { text: "Spam", onPress: () => void submitReport(slug, "SPAM") },
              {
                text: "Something else",
                onPress: () => void submitReport(slug, "OTHER"),
              },
              { text: "Cancel", style: "cancel" },
            ],
            { cancelable: true },
          );
        },
      },
    ],
    { cancelable: true },
  );
}

// Destructive confirm → POST the block → onBlocked → confirmation alert.
// Callers' onBlocked MUST invalidate BOTH the ["feed"] query (so the author's
// rows vanish instantly) and the ["blocks"] query (so the blocked-users list
// under Friends reflects the new block), and/or navigate away. `postSlug`
// threads the post that prompted the block to the server, which notifies the
// developer (Apple requires this).
export function confirmAndBlockUser({
  userId,
  label,
  postSlug,
  onBlocked,
}: {
  userId: string;
  // Display label for the user being blocked, e.g. "@mina".
  label: string;
  postSlug?: string;
  onBlocked?: () => void;
}): void {
  Alert.alert(
    `Block ${label}?`,
    "Their posts disappear from your feed immediately. You can unblock them anytime from Account → Blocked users.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await apiPostJson<{ ok: boolean }>(
                `/api/app/users/${encodeURIComponent(userId)}/block`,
                postSlug ? { postSlug } : {},
              );
              onBlocked?.();
              Alert.alert(
                "Blocked",
                `${label} won’t appear in your feed anymore.`,
              );
            } catch {
              Alert.alert(
                "Couldn’t block",
                "Check your connection and try again.",
              );
            }
          })();
        },
      },
    ],
  );
}

// The per-post "…" overflow: Report post / Block @handle / Cancel. Entry point
// for the Friends feed rows and the peer post-detail screen.
export function showPostModerationSheet({
  slug,
  author,
  onBlocked,
}: {
  slug: string;
  author: PostAuthor;
  onBlocked?: () => void;
}): void {
  const label = authorLabel(author);
  const report = () => pickReportReason(slug);
  const block = () =>
    confirmAndBlockUser({ userId: author.id, label, postSlug: slug, onBlocked });
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Report post", `Block ${label}`, "Cancel"],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) report();
        else if (index === 1) block();
      },
    );
    return;
  }
  Alert.alert(
    "Post options",
    undefined,
    [
      { text: "Report post", onPress: report },
      { text: `Block ${label}`, style: "destructive", onPress: block },
      { text: "Cancel", style: "cancel" },
    ],
    { cancelable: true },
  );
}
