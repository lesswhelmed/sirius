import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GOLDEN_QUERIES } from "../test/fixtures/search-corpus";
import {
  RUN_DB,
  fixtureEmbedder,
  seedFixtures,
  throwingEmbedder,
  truncateAll,
  userId,
} from "../test/search-harness";
import { prisma } from "./index";
import { searchCorpus } from "./search";

const suite = RUN_DB ? describe : describe.skip;
if (!RUN_DB) {
  console.warn("[search.integration] TEST_DATABASE_URL unset — skipping DB integration suite.");
}

suite("searchCorpus integration (golden matrix)", () => {
  beforeAll(async () => {
    await seedFixtures();
  });
  afterAll(async () => {
    await truncateAll();
  });

  for (const g of GOLDEN_QUERIES) {
    test(g.name, async () => {
      const page = await searchCorpus(userId(g.viewerKey), g.query, {
        scope: g.scope,
        limit: 50,
        publicCatalogEnabled: g.publicCatalogEnabled,
        embedder: g.mode === "fts-only" ? throwingEmbedder : fixtureEmbedder,
      });
      const slugs = page.items.map((i) => i.slug);

      if (g.expectPartial !== undefined) {
        expect(page.partial).toBe(g.expectPartial);
      }
      for (const [above, below] of g.rankedAbove ?? []) {
        expect(slugs).toContain(above);
        expect(slugs).toContain(below);
        expect(slugs.indexOf(above)).toBeLessThan(slugs.indexOf(below));
      }
      for (const s of g.mustNotContain ?? []) {
        expect(slugs).not.toContain(s);
      }
      for (const s of g.mustContain ?? []) {
        expect(slugs).toContain(s);
      }
      if (g.orderedSubset) {
        const idx = g.orderedSubset.map((s) => slugs.indexOf(s));
        expect(idx.every((i) => i >= 0)).toBe(true);
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      }
      if (g.exactOrder) {
        expect(slugs).toEqual(g.exactOrder);
      }
      if (g.bothLegsAboveSingle) {
        const reasons = page.items.map((i) => i.matchReasons.length);
        // Fusion actually produced both kinds (otherwise the invariant is vacuous).
        expect(reasons).toContain(2);
        expect(reasons).toContain(1);
        // Every both-legs hit precedes every single-leg hit.
        const lastBoth = reasons.lastIndexOf(2);
        const firstSingle = reasons.indexOf(1);
        expect(lastBoth).toBeLessThan(firstSingle);
      }
    });
  }

  test("pagination is stable: page1 ∪ page2 == full, no dupes/gaps", async () => {
    const opts = { scope: "all" as const, embedder: throwingEmbedder };
    const full = await searchCorpus(userId("viewer"), "zephyrium", { ...opts, limit: 50 });
    const fullSlugs = full.items.map((i) => i.slug);

    const p1 = await searchCorpus(userId("viewer"), "zephyrium", { ...opts, limit: 2 });
    const p2 = await searchCorpus(userId("viewer"), "zephyrium", {
      ...opts, limit: 2, cursor: p1.nextCursor ?? undefined,
    });
    const paged = [...p1.items, ...p2.items].map((i) => i.slug);

    expect(new Set(paged).size).toBe(paged.length); // no dupes
    expect(paged).toEqual(fullSlugs.slice(0, paged.length)); // same prefix order
  });

  // Regression: a viewer with >= 2 friends must not crash the full-text leg.
  // `= ANY(${array})` in prisma.$queryRaw expands the array into a positional
  // list (`ANY($6, $7)`) → Postgres 42601 "syntax error at or near \"$7\"".
  // The fixture viewer has exactly 1 friend, which is how the golden matrix
  // missed it — so this test adds a second accepted friendship inline.
  test("viewer with >=2 friends: full-text leg does not 42601 and friend posts stay visible", async () => {
    await prisma.user.create({
      data: {
        id: "user-second-friend",
        name: "Second Friend",
        email: "second-friend@example.test",
        emailVerified: true,
        handle: "second-friend",
      },
    });
    const [a, b] = [userId("viewer"), "user-second-friend"].sort();
    await prisma.friendship.create({
      data: { userAId: a, userBId: b, status: "ACCEPTED", requestedById: a, acceptedAt: new Date() },
    });

    // Crashes with 42601 before the Prisma.join fix; must resolve after.
    const page = await searchCorpus(userId("viewer"), "zephyrium", {
      scope: "all",
      limit: 50,
      embedder: throwingEmbedder,
    });
    const slugs = page.items.map((i) => i.slug);

    // Semantics preserved: the original friend's FRIENDS/PUBLISHED post is
    // still found, and the never-leak posts stay hidden.
    expect(slugs).toContain("friend-friends-pub");
    expect(slugs).not.toContain("stranger-private");
    expect(slugs).not.toContain("friend-friends-draft");
  });
});
