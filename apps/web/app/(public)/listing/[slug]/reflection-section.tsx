import { listReflectionForPost } from "@repo/db";
import { toReflectionItemWire } from "../../../../lib/reflections/wire";
import { ReflectionThread } from "./reflection-thread";

// The "Reflect" layer on a post: AI-generated questions the OWNER answers in
// their own words; the post's audience reads the Q&A. An async server
// component — the thread is per-user, mutating data, so it is read directly
// per request (NEVER through lib/cached.ts "use cache") and rendered inside
// the page's dynamic boundary.
//
// CRITICAL backwards-compat: posts with no reflection prompts (every
// pre-feature post) render NOTHING — the page output stays byte-identical.
//
// The caller (page.tsx) has already cleared canReadPost for the viewer; this
// component adds no visibility logic of its own — response visibility inherits
// the post's audience exactly.
export async function ReflectionSection({
  postId,
  postSlug,
  isOwner,
}: {
  postId: string;
  postSlug: string;
  isOwner: boolean;
}) {
  const items = await listReflectionForPost(postId);
  if (items.length === 0) {
    return null;
  }
  return (
    <ReflectionThread
      postSlug={postSlug}
      isOwner={isOwner}
      initialItems={items.map((item) => toReflectionItemWire(item, postSlug))}
    />
  );
}
