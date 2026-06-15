import { PrismaPg } from "@prisma/adapter-pg";
import {
  Prisma,
  PrismaClient,
  PostStatus,
  PostType,
} from "../generated/prisma";

export { Prisma, PrismaClient, PostStatus, PostType };

// Model row types come off the generated namespace; re-exporting them by name
// keeps Turbopack happy (it warns on `export *` from CJS) while still giving
// consumers the ergonomics of `import { Post, IngestSubmission } from "@repo/db"`.
export type Post = Prisma.PostGetPayload<Record<string, never>>;
export type Tag = Prisma.TagGetPayload<Record<string, never>>;
export type Category = Prisma.CategoryGetPayload<Record<string, never>>;
export type HlexiconEntry = Prisma.HlexiconEntryGetPayload<
  Record<string, never>
>;
export type IngestSubmission = Prisma.IngestSubmissionGetPayload<
  Record<string, never>
>;
export type Aspiration = Prisma.AspirationGetPayload<Record<string, never>>;
export type Project = Prisma.ProjectGetPayload<Record<string, never>>;
export type CategoryEmbedding = Prisma.CategoryEmbeddingGetPayload<
  Record<string, never>
>;
export type ProjectEmbedding = Prisma.ProjectEmbeddingGetPayload<
  Record<string, never>
>;
export type PostEmbedding = Prisma.PostEmbeddingGetPayload<
  Record<string, never>
>;
export type PostCategoryMatch = Prisma.PostCategoryMatchGetPayload<
  Record<string, never>
>;
export type ArchiveRequest = Prisma.ArchiveRequestGetPayload<
  Record<string, never>
>;

export * from "./ingest";
export * from "./posts";
export * from "./post-delete";
export * from "./users";
export * from "./saved";
export * from "./analytics";
export * from "./projects";
export * from "./embeddings";
export * from "./categories";
export * from "./classify";
export * from "./notify";
export * from "./archive";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrisma(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
