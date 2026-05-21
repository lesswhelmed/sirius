// Seed common antique-military taxonomy. Idempotent: re-running upserts.
// Run with:  bun run apps/web/scripts/seed-military-taxonomy.ts
import { prisma } from "@repo/db";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(input: string): string {
  return input
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Tags = horizontal facets (era, branch, country)
const TAGS: string[] = [
  // eras
  "wwi",
  "wwii",
  "korean-war",
  "vietnam-war",
  "cold-war",
  "post-war",
  "interwar",
  // branches
  "army",
  "navy",
  "air-force",
  "marines",
  "luftwaffe",
  "kriegsmarine",
  "ss",
  "wehrmacht",
  // countries (common collector markets)
  "us",
  "uk",
  "germany",
  "soviet-union",
  "japan",
  "italy",
  "france",
];

// Categories = vertical type of object (what you can collect)
const CATEGORIES: string[] = [
  "helmet",
  "uniform",
  "medal",
  "insignia",
  "edged-weapon",
  "firearm-parts",
  "field-gear",
  "documents",
  "photography",
  "ordnance",
];

async function main() {
  let upserts = 0;
  for (const name of TAGS) {
    const slug = slugify(name);
    await prisma.tag.upsert({
      where: { name },
      create: { name, slug },
      update: { slug },
    });
    upserts++;
  }
  for (const name of CATEGORIES) {
    const slug = slugify(name);
    await prisma.category.upsert({
      where: { name },
      create: { name, displayName: titleCase(name), slug },
      update: { displayName: titleCase(name), slug },
    });
    upserts++;
  }
  console.log(`[seed-military-taxonomy] upserted ${upserts} rows`);
  console.log(`  tags=${TAGS.length} categories=${CATEGORIES.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
