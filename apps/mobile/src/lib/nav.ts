// Guarded navigation to the post routes. Expo Router's `router.push` ALWAYS
// appends a new stack entry — even for a byte-identical route+params — with no
// dedupe. A double/rapid tap on a list row (or an onPress that fires twice)
// therefore stacks two identical `/post/[slug]` entries, so the back button
// pops back to the SAME post again and again. Every post-open funnels through
// here so one short-window dedupe kills that duplication in one place, while
// genuine post→post navigation (a DIFFERENT slug) is never blocked.
//
// Uses the imperative `router` global (not the useRouter() hook) so this stays
// a plain module callable from anywhere — matching the existing pattern in
// library.tsx, corpus-search.tsx, llm.tsx, etc. The pure dedupe decision lives
// in nav-dedupe.ts so it can be unit-tested without loading react-native.
import { type Href, router } from "expo-router";

import { isDuplicateNavigation } from "./nav-dedupe";

let lastHref: string | null = null;
let lastAt = 0;

function guardedPush(href: string): void {
  const now = Date.now();
  if (isDuplicateNavigation(href, lastHref, lastAt, now)) return;
  lastHref = href;
  lastAt = now;
  // The open* builders only ever produce valid /post routes; the string form is
  // what we dedupe on, so cast at the typed-routes boundary.
  router.push(href as Href);
}

// `from` is the originating surface label the post screen shows on the back
// button (e.g. "Catalog"); omit it where the previous screen's own title is
// already the right label.
export function openPost(slug: string, from?: string): void {
  guardedPush(from ? `/post/${slug}?from=${from}` : `/post/${slug}`);
}

export function openLocalPost(localId: string, from?: string): void {
  guardedPush(
    from ? `/post/local/${localId}?from=${from}` : `/post/local/${localId}`,
  );
}

export function openPostEdit(slug: string): void {
  guardedPush(`/post/${slug}/edit`);
}
