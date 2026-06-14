"use client";

import Image from "next/image";
import { useState } from "react";

// Single source of truth for rendering a post's cover image. Always rendered as
// a `fill` child inside a positioned aspect-ratio box owned by the caller.
//
// - Local media (/social/, /sight/) IS run through the Next image optimizer
//   (unoptimized=false). The worker writes these files at runtime, so they're
//   served by the app/sight + app/social route handlers (the optimizer's
//   in-process internal fetch resolves through them), and by Caddy file_server
//   in production. Optimizing matters: sight originals can be >10 MB.
// - Remote URLs are left unoptimized so a third-party host (e.g. an expired
//   Instagram CDN link) can't 403 the Next image optimizer and fail the route.
// - Any load failure (missing file, expired remote URL) degrades to a quiet
//   "No plate" placeholder instead of a broken-image box.
export function PostImage({
  src,
  alt,
  sizes,
  className = "object-cover",
  priority = false,
}: {
  src: string | null | undefined;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-subtle)]">
        No plate
      </div>
    );
  }

  const isLocal = src.startsWith("/");
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      className={className}
      unoptimized={!isLocal}
      priority={priority}
      onError={() => setFailed(true)}
    />
  );
}
