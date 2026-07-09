// Shared types for the worker pipeline. PipelineInput is the union the worker
// hands to every pipeline stage; each stage narrows on `kind`.
import type { IngestSubmission, PostType } from "@repo/db";

export type IngestKind =
  | "url"
  | "image"
  | "note"
  | "video"
  | "audio"
  | "document";

export type StagedImage = {
  submissionId: string;
  index: number;
  stagedFilePath: string;
  extension: string;
};

export type PipelineInput =
  | {
      kind: "url";
      submission: IngestSubmission;
      urls: string[];
      notes: string;
      force: boolean;
      // Optional client-supplied draft envelope (single-url extraction/
      // generation split only). Untrusted — draft-runner.ts re-validates.
      draft?: unknown;
      submittedById: string | null;
      projectId: string | null;
      // Optional pre-resolved author voice. Currently the worker resolves this
      // itself from submittedById in runGemini, but the field is here so callers
      // can pass it explicitly if already loaded.
      voiceProfile?: string | null;
    }
  | {
      kind: "note";
      submission: IngestSubmission;
      notes: string;
      // Optional client-supplied draft envelope (on-device LLM), persisted in
      // the submission payload. `unknown` on purpose: stored JSON is never
      // trusted — draft-runner.ts re-validates with DraftEnvelopeSchema.
      draft?: unknown;
      submittedById: string | null;
      projectId: string | null;
      voiceProfile?: string | null;
    }
  | {
      kind: "image";
      submissions: IngestSubmission[];
      batchId: string;
      notes: string;
      // Same as note.draft, validated against SightDraftEnvelopeSchema.
      draft?: unknown;
      images: StagedImage[];
      submittedById: string | null;
      projectId: string | null;
      voiceProfile?: string | null;
    }
  | {
      // Single-file reference-only kinds. The worker feeds the staged file to
      // Gemini for understanding but does NOT store or serve the bytes — the
      // generated Post body is text-only (summary/transcript). No media copy.
      kind: "video" | "audio" | "document";
      submission: IngestSubmission;
      stagedFilePath: string;
      mimeType: string;
      extension: string;
      notes: string;
      submittedById: string | null;
      projectId: string | null;
      voiceProfile?: string | null;
    };

export type GeminiOutput = {
  slug: string;
  title: string;
  type: PostType;
  body: string;
  frontmatter: Record<string, unknown>;
  rawMdx: string;
};

export type PipelineResult = {
  postSlug: string;
  postId: string;
  // How the body was produced this run: "full" = AI analysis; "stub" =
  // over-quota degraded bookmark. Copied onto the Post row (the regeneration
  // gate) and onto the completed submission (audit).
  aiTreatment: "full" | "stub";
};
