"use client";

import { useEffect, useRef } from "react";

// Records a single view on mount. Kept as a client beacon (not a server-render
// side effect) so it stays dynamic and won't fire inside a cached page render.
export function ViewBeacon({ slug }: { slug: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return; // guard StrictMode double-mount in dev
    sent.current = true;
    void fetch(`/api/app/posts/${slug}/view`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // best-effort; a missed view is not worth surfacing
    });
  }, [slug]);

  return null;
}
