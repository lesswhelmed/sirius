"use client";

import type { EmbeddingScene } from "@repo/embedding-scene/types";
import { useEffect, useState } from "react";

// Process-lived cache so multiple islands (rail, related-posts) share one fetch.
let cached: Promise<EmbeddingScene | null> | null = null;

function loadScene(): Promise<EmbeddingScene | null> {
  cached ??= fetch("/api/app/embedding-scene")
    .then((r) => (r.ok ? (r.json() as Promise<EmbeddingScene>) : null))
    .catch(() => null);
  return cached;
}

// Owner-scoped scene for client islands. Returns null while loading OR when the
// viewer isn't signed in (the API 401s) — callers render nothing on null.
export function useSceneClient(): EmbeddingScene | null {
  const [scene, setScene] = useState<EmbeddingScene | null>(null);
  useEffect(() => {
    let live = true;
    loadScene().then((s) => {
      if (live) setScene(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return scene;
}

// Day-stable YYYYMMDD seed from the browser clock — mirrors mobile's todaySeed().
export function todaySeed(): number {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}
