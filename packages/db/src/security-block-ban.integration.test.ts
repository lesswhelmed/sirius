// Headless DB-integration regression for two moderation security fixes:
//
//   #4 comments block-exclusion — listCommentsForPost(postId, { blockedIds })
//      hides comments authored by a blocked user, NULL-safe (AGENT/orphaned
//      authors are never swallowed). See packages/db/src/comments.ts.
//   #5 banned-user API-key revocation — the DB-layer operation cmdBan performs
//      (scripts/moderation/resolve-report.ts): prisma.apiKey.deleteMany({
//      where: { referenceId } }) fully revokes a banned owner's keys, which the
//      MCP service (apps/mcp/src/auth.ts) relies on as its primary defense.
//
// Gated on TEST_DATABASE_URL like search.integration.test.ts — no-ops when the
// test DB isn't configured. Runs from packages/db via:
//   bun test --preload ./test/setup-env.ts src/security-block-ban.integration.test.ts
//
// Fixture hygiene: a swarm shares this DB. Every row is created under a unique
// `sec-blockban-<random>-` prefix and afterAll deletes ONLY those rows. No
// truncate / reset — existing rows are never touched.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  blockedIdsFor,
  createComment,
  listCommentsForPost,
  prisma,
} from "./index";

const RUN_DB = Boolean(process.env.TEST_DATABASE_URL);
const suite = RUN_DB ? describe : describe.skip;
if (!RUN_DB) {
  console.warn(
    "[security-block-ban.integration] TEST_DATABASE_URL unset — skipping DB integration suite.",
  );
}

// Unique-per-run namespace so parallel swarm runs never collide and cleanup is
// exact.
const PREFIX = `sec-blockban-${randomUUID().slice(0, 8)}`;
const id = (s: string) => `${PREFIX}-${s}`;

// IDs we create — used for both seeding and the scoped afterAll cleanup.
const A_ID = id("userA");
const B_ID = id("userB");
const U_ID = id("userU"); // the "banned" owner for #5
const POST_ID = id("postP");
const POST_SLUG = id("post-p");
const BLOCK_ID = id("block");
const API_KEY_ID = id("apikey");

async function seedUser(userId: string, label: string) {
  await prisma.user.create({
    data: {
      id: userId,
      name: `${label} ${PREFIX}`,
      email: `${userId}@blockban.test`,
      emailVerified: true,
      handle: userId, // handles are unique; the prefixed id is safe
    },
  });
}

suite("moderation security: comments block-exclusion (#4) + ban key revocation (#5)", () => {
  beforeAll(async () => {
    // --- users ---
    await seedUser(A_ID, "Author A");
    await seedUser(B_ID, "Commenter B");
    await seedUser(U_ID, "Banned Owner U");

    // --- post P authored by A ---
    await prisma.post.create({
      data: {
        id: POST_ID,
        slug: POST_SLUG,
        title: `Post P ${PREFIX}`,
        content: "body",
        type: "BLOG",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        filePath: `${PREFIX}/post-p.mdx`,
        fileHash: id("hash"),
        submittedById: A_ID,
      },
    });

    // --- three active comments on P: A (human), B (human), AGENT (authorId null) ---
    await createComment({ postId: POST_ID, authorId: A_ID, body: `A comment ${PREFIX}` });
    await createComment({ postId: POST_ID, authorId: B_ID, body: `B comment ${PREFIX}` });
    // AGENT comment is written through a separate entrypoint in production; here
    // we insert it directly to exercise the NULL-safe arm of the block filter.
    await prisma.comment.create({
      data: {
        postId: POST_ID,
        authorKind: "AGENT",
        authorId: null,
        agentName: "Gemini",
        body: `agent comment ${PREFIX}`,
        status: "active",
      },
    });
  });

  afterAll(async () => {
    // Delete ONLY rows we created, children-first. Comments/apiKey cascade on
    // post/user delete anyway, but explicit scoped deletes keep this robust and
    // provably non-destructive.
    await prisma.comment.deleteMany({ where: { postId: POST_ID } });
    await prisma.apiKey.deleteMany({ where: { id: API_KEY_ID } });
    await prisma.userBlock.deleteMany({ where: { id: BLOCK_ID } });
    await prisma.post.deleteMany({ where: { id: POST_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [A_ID, B_ID, U_ID] } } });
  });

  // #4.2 — blocked viewer: B's comment excluded, A's + AGENT's kept.
  test("listCommentsForPost excludes a blocked author but keeps null-author + non-blocked", async () => {
    const page = await listCommentsForPost(POST_ID, { blockedIds: [B_ID] });
    const authorIds = page.items.map((c) => c.authorId);

    expect(page.items.length).toBe(2);
    expect(authorIds).toContain(A_ID); // A kept
    expect(authorIds).toContain(null); // AGENT (null author) kept — NULL-safe
    expect(authorIds).not.toContain(B_ID); // B excluded (pre-fix: present)
  });

  // #4.3 — no blockedIds: full thread unchanged (all three).
  test("listCommentsForPost with no blockedIds returns all three comments", async () => {
    const page = await listCommentsForPost(POST_ID, {});
    const authorIds = page.items.map((c) => c.authorId);

    expect(page.items.length).toBe(3);
    expect(authorIds).toContain(A_ID);
    expect(authorIds).toContain(B_ID);
    expect(authorIds).toContain(null);
  });

  // #4.4 — route wiring: blockedIdsFor is bidirectional when a UserBlock exists.
  test("blockedIdsFor returns the bidirectional block set", async () => {
    // A blocks B.
    await prisma.userBlock.create({
      data: { id: BLOCK_ID, blockerId: A_ID, blockedId: B_ID },
    });

    // Blocker sees the blocked id...
    const forA = await blockedIdsFor(A_ID);
    expect(forA).toContain(B_ID);
    // ...and the blocked user sees the blocker (the other direction).
    const forB = await blockedIdsFor(B_ID);
    expect(forB).toContain(A_ID);

    // And the exclusion feeds listCommentsForPost end-to-end: with A's block set,
    // B's comment drops out of P's thread.
    const page = await listCommentsForPost(POST_ID, { blockedIds: forA });
    expect(page.items.map((c) => c.authorId)).not.toContain(B_ID);
  });

  // #5.5 — the DB-layer revocation cmdBan relies on. Not calling cmdBan directly:
  // it is un-exported and its module runs main() (a CLI) at import time, so
  // importing it would execute the script. We assert the exact prisma op cmdBan
  // performs — prisma.apiKey.deleteMany({ where: { referenceId } }).
  test("banning a user revokes all their API keys (referenceId deleteMany)", async () => {
    await prisma.apiKey.create({
      data: {
        id: API_KEY_ID,
        key: id("secret-key"),
        referenceId: U_ID, // apiKey() plugin keys rows to the owner via referenceId
        name: `${PREFIX} key`,
        enabled: true,
      },
    });

    // Pre-condition: the key exists for U.
    const before = await prisma.apiKey.count({ where: { referenceId: U_ID } });
    expect(before).toBeGreaterThanOrEqual(1);

    // The exact operation cmdBan runs.
    const revoked = await prisma.apiKey.deleteMany({ where: { referenceId: U_ID } });
    expect(revoked.count).toBeGreaterThanOrEqual(1);

    // Post-condition: zero keys remain — the banned owner has no bearer access.
    const after = await prisma.apiKey.count({ where: { referenceId: U_ID } });
    expect(after).toBe(0);
  });
});
