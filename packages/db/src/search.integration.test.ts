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
      if (g.orderedSubset) {
        const idx = g.orderedSubset.map((s) => slugs.indexOf(s));
        expect(idx.every((i) => i >= 0)).toBe(true);
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      }
      if (g.exactOrder) {
        expect(slugs).toEqual(g.exactOrder);
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
});
