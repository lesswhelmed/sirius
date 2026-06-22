// Black-box unit test for writePost's category-creation contract. No DB, no
// Gemini, no filesystem: we mock the module boundaries (@repo/db prisma client,
// revalidate, image-gen) and assert that writePost translates a draft's
// `frontmatter.categories` into Prisma `connectOrCreate` ops on the Post upsert.
//
// This proves the observable behavior — "categories from an ingested draft are
// requested for creation" — without asserting on writePost's internals. It does
// NOT prove Postgres inserts rows (the connectOrCreate semantics are Prisma's);
// that would require the real-DB integration variant.
import { beforeEach, expect, mock, test } from "bun:test";
import type { IngestSubmission } from "@repo/db";
import * as dbActual from "@repo/db";
import type { GeminiOutput, PipelineInput } from "./types";

// Neutralize the two env-gated side effects writePost would otherwise take for a
// `note` ingest, WITHOUT mocking their modules (mock.module is process-global in
// bun and leaks into other test files). Cover generation defaults ON, and
// revalidate fires a fetch when its URL+token are set — bun auto-loads .env, so
// force both off here.
process.env.IMAGE_GEN_ENABLED = "false";
process.env.WEB_REVALIDATE_URL = "";
process.env.REVALIDATE_TOKEN = "";

// Capture every prisma.post.upsert call so we can inspect the args writePost
// builds. The upsert is keyed on the source identity now (not the slug), so the
// stub row reads its slug from `create`. Returns a stub row shaped like the real
// upsert result.
type UpsertArgs = {
  where: {
    providerId_sourceRecordId: { providerId: string; sourceRecordId: string };
  };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};
const upsertCalls: UpsertArgs[] = [];
const upsertMock = mock(async (args: UpsertArgs) => {
  upsertCalls.push(args);
  return { id: "post_test_1", slug: args.create.slug as string };
});

// Stub the prisma.post reads/writes writePost touches; spread the rest of
// @repo/db's real exports so other test files importing @repo/db (e.g.
// resolve-categories.test.ts) still see a complete module. (`Prisma` is a
// type-only import in post-writer.ts, so it's erased — no runtime export needed.)
// findFirst/findUnique back resolveSlug: no existing source and no slug clash, so
// it returns the draft's slug unchanged and the upsert runs exactly once.
mock.module("@repo/db", () => ({
  ...dbActual,
  prisma: {
    post: {
      upsert: upsertMock,
      findFirst: mock(async () => null),
      findUnique: mock(async () => null),
    },
  },
}));

// Import the unit under test AFTER the mock is registered (static imports are
// hoisted above mock.module calls, so a dynamic import is required here).
const { writePost } = await import("./post-writer");

function noteInput(): PipelineInput {
  const submission = {
    id: "sub_1",
    contentHash: "hash_abc",
  } as unknown as IngestSubmission;
  return {
    kind: "note",
    submission,
    notes: "a note",
    submittedById: null,
    projectId: null,
  };
}

function draftWithCategories(categories: string[]): GeminiOutput {
  return {
    slug: "test-post",
    title: "Test Post",
    type: "BLOG" as GeminiOutput["type"],
    body: "Some body text.",
    rawMdx: "",
    frontmatter: { categories, tags: [] },
  };
}

// Reads the {tag}.connectOrCreate array off the captured upsert call.
function connectOrCreateOf(
  branch: "create" | "update",
  relation: "categories" | "tags" = "categories",
): Array<{ where: { name: string }; create: Record<string, unknown> }> {
  const call = upsertCalls[0];
  if (!call) {
    throw new Error("prisma.post.upsert was never called");
  }
  const rel = call[branch][relation] as
    | { connectOrCreate?: unknown }
    | undefined;
  return (rel?.connectOrCreate ?? []) as Array<{
    where: { name: string };
    create: Record<string, unknown>;
  }>;
}

beforeEach(() => {
  upsertCalls.length = 0;
  upsertMock.mockClear();
});

test("writePost connectOrCreates only the PRIMARY category; surplus categories are demoted to tags", async () => {
  await writePost(
    draftWithCategories([
      "technology/artificial-intelligence",
      "design/typography",
    ]),
    noteInput(),
  );

  expect(upsertMock).toHaveBeenCalledTimes(1);

  // A post carries exactly ONE category (see post-writer.ts / assign-org.ts):
  // the primary is the model's FIRST proposal (most-representative), keyed by the
  // LEAF segment of its slash-path so the fallback label matches what the
  // classification resolver later reconciles to.
  const connects = connectOrCreateOf("create");
  expect(connects.map((c) => c.where.name)).toEqual([
    "artificial-intelligence",
  ]);

  // The op is a real create payload: matches by name, creates name+slug+displayName.
  const op = connects[0]!;
  expect(op.create.name).toBe(op.where.name);
  expect(typeof op.create.slug).toBe("string");
  expect((op.create.slug as string).length).toBeGreaterThan(0);
  expect(typeof op.create.displayName).toBe("string");
  expect((op.create.displayName as string).length).toBeGreaterThan(0);

  // Every surplus category (also by LEAF) is demoted to a tag so it stays
  // surfaced and filterable rather than being dropped.
  const tagConnects = connectOrCreateOf("create", "tags");
  expect(tagConnects.map((t) => t.where.name)).toContain("typography");
});

test("a slash-path category is created by its LEAF segment, not the full path", async () => {
  await writePost(draftWithCategories(["lifestyle/beekeeping"]), noteInput());

  const connects = connectOrCreateOf("create");
  expect(connects.map((c) => c.where.name)).toEqual(["beekeeping"]);
  // The create payload is keyed by the same leaf name (avoids orphan path-rows).
  expect(connects[0]?.create.name).toBe("beekeeping");
});

test("the same connectOrCreate ops appear on both the create and update branches", async () => {
  await writePost(
    draftWithCategories(["technology/artificial-intelligence"]),
    noteInput(),
  );

  expect(connectOrCreateOf("update")).toEqual(connectOrCreateOf("create"));
});

test("duplicate categories are deduped case-insensitively before creation", async () => {
  await writePost(
    draftWithCategories([
      "Technology",
      "technology", // case-only duplicate
      " technology ", // whitespace duplicate
    ]),
    noteInput(),
  );

  const connects = connectOrCreateOf("create");
  // One survivor, keeping the first occurrence's (trimmed) original casing.
  expect(connects.map((c) => c.where.name)).toEqual(["Technology"]);
});

test("a draft with no categories produces an empty connectOrCreate (post still written)", async () => {
  await writePost(draftWithCategories([]), noteInput());

  expect(upsertMock).toHaveBeenCalledTimes(1);
  expect(connectOrCreateOf("create")).toEqual([]);
});
