// Short, neutral words used to break a slug collision (post-writer.resolveSlug).
// When a title-derived slug already exists for a DIFFERENT source, we append one
// of these instead of an incrementing number — `my-trip-otter` reads less like a
// "page 2" than `my-trip-2`, and a random pick avoids a guess-the-next-int race.
// Kept deliberately bland (animals / nature / textures) so a suffix never implies
// meaning. crypto-backed selection keeps picks uniform without Math.random.

import { randomInt } from "node:crypto";

const SLUG_WORDS = [
  "otter",
  "finch",
  "cedar",
  "maple",
  "heron",
  "quartz",
  "ember",
  "willow",
  "cove",
  "dune",
  "fjord",
  "glade",
  "harbor",
  "ivy",
  "juniper",
  "kelp",
  "larch",
  "marsh",
  "nimbus",
  "onyx",
  "pebble",
  "reef",
  "sage",
  "tide",
  "umber",
  "vale",
  "wren",
  "yarrow",
  "zephyr",
  "aspen",
  "basalt",
  "cobalt",
  "delta",
  "elm",
  "fern",
  "grove",
  "hazel",
  "indigo",
  "jade",
  "knoll",
  "loam",
  "mist",
  "north",
  "opal",
  "pine",
  "ridge",
  "slate",
  "thorn",
  "verge",
  "wisp",
  "amber",
  "birch",
  "cliff",
  "drift",
  "flint",
  "gale",
  "moss",
  "river",
  "spruce",
  "stone",
] as const;

// One random word from the list.
export function randomSlugWord(): string {
  return SLUG_WORDS[randomInt(0, SLUG_WORDS.length)]!;
}
