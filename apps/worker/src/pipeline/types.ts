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
      submittedById: string | null;
      projectId: string | null;
    }
  | {
      kind: "note";
      submission: IngestSubmission;
      notes: string;
      submittedById: string | null;
      projectId: string | null;
    }
  | {
      kind: "image";
      submissions: IngestSubmission[];
      batchId: string;
      notes: string;
      images: StagedImage[];
      submittedById: string | null;
      projectId: string | null;
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
};
