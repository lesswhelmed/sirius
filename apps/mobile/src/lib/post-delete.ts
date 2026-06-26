// Owner-only post deletion, shared by the catalog swipe action and the post
// detail Delete button so the two call sites can never drift. Mirrors the web
// flow (apps/web/.../delete-post-button.tsx): confirm → DELETE → leave the list.
import { Alert } from "react-native";

import { apiDelete, ApiError } from "@/lib/api";
import { applyTombstone } from "@/lib/sync/reconcile";

// Server DELETE (cascades the post's source originals), then optimistically
// tombstone the local mirror row so it leaves every live query immediately. The
// next delta pull confirms it. serverId is required to tombstone — a row without
// one was never synced and isn't server-deletable. Returns true on success.
export async function deletePost(
  slug: string,
  serverId: string | null,
): Promise<boolean> {
  try {
    await apiDelete(`/api/app/posts/${slug}`);
    if (serverId) {
      await applyTombstone(serverId, new Date().toISOString());
    }
    return true;
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn(`[post-delete] failed (${err.status})`);
    } else {
      console.warn("[post-delete] failed", err);
    }
    return false;
  }
}

// Native confirm (mirrors web's window.confirm copy), then delete on accept.
// `onDone` fires only after a successful delete so callers can navigate away.
export function confirmAndDeletePost({
  slug,
  serverId,
  onDone,
}: {
  slug: string;
  serverId: string | null;
  onDone?: () => void;
}): void {
  Alert.alert(
    "Delete post",
    "Delete this post and its source files permanently? This cannot be undone.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deletePost(slug, serverId).then((ok) => {
            if (ok) onDone?.();
          });
        },
      },
    ],
  );
}
