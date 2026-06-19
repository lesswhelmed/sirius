// The worker tags org rows it mints with metadata.autoCreated = true
// (apps/worker assign-org stage; scripts/dedupe-org.ts backfilled older rows).
// Prisma types Json columns as JsonValue, so narrow defensively.
export function isAutoCreated(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as { autoCreated?: unknown }).autoCreated === true
  );
}
