// Seed the global Analysis Category taxonomy into CategoryEmbedding with
// precomputed gemini-embedding-2 vectors. This is the domain-agnostic index the
// auto-org reverse lookup matches captured content against — deliberately
// general and domain-agnostic (not tied to any one collection type) so it
// generalizes across users and content domains.
//
// Lives in apps/worker (not apps/web) because it needs the embedding client and
// the worker already owns the Gemini deps. Idempotent: re-runs upsert by `path`
// and skip re-embedding when the embeddingHash (model+dim+text) is unchanged.
//
// Usage (from repo root so root .env loads):
//   bun apps/worker/scripts/seed-analysis-categories.ts
import { listCategoryEmbeddings, upsertCategoryEmbedding } from "@repo/db";
import { getEmbeddingDimensionality, getEmbeddingModel } from "../src/lib/ai-config";
import { documentText, embedContent, embeddingHash } from "../src/lib/embeddings";

// One node per analysis facet. `path` is the slash-delimited full path; the rest
// (name/parentPath/depth) is derived. Keep names lowercase kebab-case, generic,
// and reverse-lookup friendly.
type SeedNode = { path: string; purpose: string; description: string };

const ROOT: SeedNode = {
  path: "analysis",
  purpose: "Root of the content analysis taxonomy used to auto-file captured material.",
  description: "Top-level container for all analysis facets.",
};

const NODES: SeedNode[] = [
  ROOT,

  // ── subject-matter: what the content is ABOUT ──────────────────────────────
  {
    path: "analysis/subject-matter",
    purpose: "Groups material by the real-world subject it depicts or discusses.",
    description: "What the captured content is fundamentally about.",
  },
  {
    path: "analysis/subject-matter/people-and-orgs",
    purpose: "Cluster content centered on individuals, groups, companies, or institutions.",
    description: "People, organizations, brands, teams, and the relationships among them.",
  },
  {
    path: "analysis/subject-matter/places",
    purpose: "Cluster content centered on locations and geography.",
    description: "Cities, regions, venues, landmarks, and physical or virtual places.",
  },
  {
    path: "analysis/subject-matter/objects-and-artifacts",
    purpose: "Cluster content centered on physical or made objects.",
    description: "Products, tools, garments, collectibles, devices, and tangible artifacts.",
  },
  {
    path: "analysis/subject-matter/events",
    purpose: "Cluster content centered on happenings in time.",
    description: "Announcements, occurrences, milestones, launches, and time-bound activity.",
  },
  {
    path: "analysis/subject-matter/concepts-and-ideas",
    purpose: "Cluster content centered on abstract ideas rather than concrete things.",
    description: "Theories, methods, frameworks, arguments, and intellectual concepts.",
  },
  {
    path: "analysis/subject-matter/nature-and-science",
    purpose: "Cluster content about the natural world and scientific subjects.",
    description: "Biology, physics, environment, materials, and natural phenomena.",
  },
  {
    path: "analysis/subject-matter/media-and-culture",
    purpose: "Cluster content about creative and cultural works.",
    description: "Books, film, music, art, games, and cultural commentary.",
  },

  // ── artifact-type: what KIND of thing the capture is ───────────────────────
  {
    path: "analysis/artifact-type",
    purpose: "Groups material by the form of the captured artifact itself.",
    description: "The medium or container of the captured item, independent of subject.",
  },
  {
    path: "analysis/artifact-type/physical-object",
    purpose: "Flag captures whose subject is a tangible object.",
    description: "Real-world items photographed or described as objects.",
  },
  {
    path: "analysis/artifact-type/image-or-photo",
    purpose: "Flag captures that are primarily still imagery.",
    description: "Photographs, screenshots, scans, and other still images.",
  },
  {
    path: "analysis/artifact-type/video",
    purpose: "Flag captures that are primarily moving image.",
    description: "Clips, reels, recordings, and other video material.",
  },
  {
    path: "analysis/artifact-type/audio",
    purpose: "Flag captures that are primarily sound.",
    description: "Voice memos, music, podcasts, and other audio material.",
  },
  {
    path: "analysis/artifact-type/document-or-text",
    purpose: "Flag captures that are primarily written or document content.",
    description: "PDFs, articles, notes, and long-form text.",
  },
  {
    path: "analysis/artifact-type/web-resource",
    purpose: "Flag captures that originate as a web link or page.",
    description: "URLs, web articles, and online resources.",
  },
  {
    path: "analysis/artifact-type/social-post",
    purpose: "Flag captures that originate from a social platform.",
    description: "Instagram, video-platform, and other social-network posts.",
  },

  // ── intent: WHY it was captured ────────────────────────────────────────────
  {
    path: "analysis/intent",
    purpose: "Groups material by the user's apparent reason for capturing it.",
    description: "The motivation behind saving this content.",
  },
  {
    path: "analysis/intent/collect",
    purpose: "Flag content saved to build or grow a collection.",
    description: "Items kept as part of an ongoing collection or catalog.",
  },
  {
    path: "analysis/intent/research",
    purpose: "Flag content saved to investigate or learn about a topic.",
    description: "Material gathered to study, compare, or understand something.",
  },
  {
    path: "analysis/intent/reference",
    purpose: "Flag content saved for later lookup or reuse.",
    description: "How-tos, specs, and material kept as a future reference.",
  },
  {
    path: "analysis/intent/inspiration",
    purpose: "Flag content saved as creative or aspirational fuel.",
    description: "Mood, ideas, and examples kept for inspiration.",
  },
  {
    path: "analysis/intent/publish",
    purpose: "Flag content captured to turn into a published piece.",
    description: "Drafts and source material intended for publication.",
  },
  {
    path: "analysis/intent/transact",
    purpose: "Flag content tied to buying, selling, or valuation.",
    description: "Listings, prices, and commerce-oriented material.",
  },

  // ── domain: broad field ────────────────────────────────────────────────────
  {
    path: "analysis/domain",
    purpose: "Groups material by the broad field of knowledge or activity it sits in.",
    description: "High-level domain such as history, technology, or commerce.",
  },
  {
    path: "analysis/domain/history",
    purpose: "Cluster content situated in historical context.",
    description: "Historical objects, events, and accounts.",
  },
  {
    path: "analysis/domain/technology",
    purpose: "Cluster content about technology and engineering.",
    description: "Software, hardware, tools, and technical subjects.",
  },
  {
    path: "analysis/domain/design",
    purpose: "Cluster content about visual, product, or experience design.",
    description: "Aesthetics, typography, UX, and design craft.",
  },
  {
    path: "analysis/domain/commerce",
    purpose: "Cluster content about business, markets, and trade.",
    description: "Products, pricing, brands, and commercial activity.",
  },
  {
    path: "analysis/domain/art",
    purpose: "Cluster content about fine art and creative practice.",
    description: "Painting, sculpture, craft, and artistic works.",
  },
  {
    path: "analysis/domain/education",
    purpose: "Cluster content with a learning or instructional purpose.",
    description: "Tutorials, courses, explanations, and study material.",
  },
  {
    path: "analysis/domain/lifestyle",
    purpose: "Cluster content about everyday living and personal interests.",
    description: "Food, travel, fashion, hobbies, and lifestyle topics.",
  },
  {
    path: "analysis/domain/finance",
    purpose: "Cluster content about money, value, and investment.",
    description: "Pricing, markets, valuation, and financial topics.",
  },

  // ── modality: ingest modality (loosely maps to PostType) ───────────────────
  {
    path: "analysis/modality",
    purpose: "Groups material by how it entered the system.",
    description: "The ingest modality, loosely mapping to the resulting post type.",
  },
  {
    path: "analysis/modality/url-finding",
    purpose: "Flag content ingested from a generic web link.",
    description: "URL captures that become FINDING posts.",
  },
  {
    path: "analysis/modality/note-blog",
    purpose: "Flag content ingested as a written note.",
    description: "Free-text notes that become BLOG posts.",
  },
  {
    path: "analysis/modality/image-sight",
    purpose: "Flag content ingested as a photo batch.",
    description: "Image batches that become SIGHT posts.",
  },
  {
    path: "analysis/modality/social",
    purpose: "Flag content ingested from a social platform.",
    description: "Instagram and similar captures that become SOCIAL posts.",
  },
  {
    path: "analysis/modality/av-media",
    purpose: "Flag content ingested as video or audio for understanding.",
    description: "Reference-only video/audio whose meaning is summarized into text.",
  },
];

function deriveNode(node: SeedNode) {
  const segments = node.path.split("/");
  const name = segments[segments.length - 1]!;
  const depth = segments.length - 1;
  const parentPath = depth === 0 ? null : segments.slice(0, -1).join("/");
  return { name, depth, parentPath };
}

async function main(): Promise<void> {
  const modelVersion = getEmbeddingModel();
  const dimensionality = getEmbeddingDimensionality();

  const existing = new Map(
    (await listCategoryEmbeddings()).map((row) => [row.path, row.embeddingHash])
  );

  let embedded = 0;
  let skipped = 0;
  for (const node of NODES) {
    const { name, depth, parentPath } = deriveNode(node);
    const docText = documentText(name, `${node.purpose} ${node.description}`);
    const hash = embeddingHash(docText);

    if (existing.get(node.path) === hash) {
      skipped++;
      continue;
    }

    const embedding = await embedContent([{ text: docText }], { dimensionality });
    await upsertCategoryEmbedding({
      path: node.path,
      name,
      source: "seed",
      fullPath: node.path,
      parentPath,
      depth,
      fileCount: 0,
      description: node.description,
      purpose: node.purpose,
      embedding,
      embeddingHash: hash,
      modelVersion,
      dimensionality,
    });
    embedded++;
    console.log(`  embedded ${node.path} (depth ${depth})`);
  }

  console.log(
    `[seed-analysis-categories] ${NODES.length} nodes — embedded ${embedded}, skipped ${skipped} (model=${modelVersion}, dim=${dimensionality})`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-analysis-categories] failed:", err);
    process.exit(1);
  });
