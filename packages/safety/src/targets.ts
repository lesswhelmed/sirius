// The wire shape handed to the classifier: a heterogeneous list of text/media
// parts to judge. The worker builds these from ingest submissions (notes, staged
// images, fetched PDFs — that host-specific target-BUILDING logic stays in the
// worker). The web publish/edit gate has only plain text (title/body/excerpt) and
// builds targets via buildTextScanTargets below.
export type ScanTarget =
  | { kind: "text"; label: string; text: string }
  | { kind: "image"; data: Buffer; mediaType: string }
  | { kind: "file"; data: Buffer; mediaType: string };

// Builds text scan targets from a set of labeled fields, dropping empty/blank
// ones. Used by the web publish/edit gate to scan a post's final title, body,
// and excerpt before it goes (or stays) PUBLISHED.
export function buildTextScanTargets(
  fields: Array<{ label: string; text: string | null | undefined }>,
): ScanTarget[] {
  const targets: ScanTarget[] = [];
  for (const field of fields) {
    const trimmed = field.text?.trim();
    if (trimmed) targets.push({ kind: "text", label: field.label, text: trimmed });
  }
  return targets;
}
