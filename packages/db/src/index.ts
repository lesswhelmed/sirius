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

export * from "./ingest";
export * from "./posts";
export * from "./users";
export * from "./inquiries";

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
