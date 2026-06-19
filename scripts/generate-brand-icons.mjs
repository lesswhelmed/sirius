// Regenerates the Sirius brand assets (app icons, favicons, visible logo mark)
// from the source photo. Outputs are committed; this script exists so the set
// can be reproduced deterministically if the crop or source ever changes.
//
// Run from the web app so `sharp` resolves (it's a dependency of apps/web):
//   node ../../scripts/generate-brand-icons.mjs   # cwd: apps/web
// or from the repo root:
//   node --import file://$PWD/apps/web/node_modules/.bin/.. ...  (avoid; just:)
//   (cd apps/web && node ../../scripts/generate-brand-icons.mjs)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "apps/web/public/IMG_4297.JPG");

// Full-bleed crop centered on the cat's face + bag, for square/rounded icons
// (iOS rounds corners itself; the web favicon and logo mark also use this).
const FACE = { left: 300, top: 430, width: 800, height: 800 };
// A slightly wider, vertically-centered crop so the glowing eyes stay inside
// Android's circular adaptive-icon mask + safe zone.
const FACE_CENTERED = { left: 290, top: 360, width: 830, height: 830 };

// Shared tone polish: deepen the blacks of the bag/fur and let the eyes pop.
function polished(crop) {
  return sharp(SRC)
    .extract(crop)
    .modulate({ brightness: 0.97, saturation: 1.1 })
    .linear(1.1, -10);
}

// Apple-style squircle-ish rounded corners on a transparent canvas, so the mark
// reads as an app badge over a solid background (splash screen, site chrome).
function roundedMask(size) {
  const r = Math.round(size * 0.2237);
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`,
  );
}

async function square({ crop, size, out }) {
  await polished(crop).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}

async function rounded({ crop, size, out }) {
  const base = await polished(crop).resize(size, size).png().toBuffer();
  await sharp(base)
    .composite([{ input: roundedMask(size), blend: "dest-in" }])
    .png()
    .toFile(out);
  console.log(`wrote ${out} (${size}x${size}, rounded)`);
}

const MOBILE = join(REPO_ROOT, "apps/mobile/assets/images");
const WEB_APP = join(REPO_ROOT, "apps/web/app");
const WEB_PUBLIC = join(REPO_ROOT, "apps/web/public");

await Promise.all([
  // Mobile (Expo) — paths referenced by apps/mobile/app.json.
  square({ crop: FACE, size: 1024, out: join(MOBILE, "icon.png") }),
  square({
    crop: FACE_CENTERED,
    size: 1024,
    out: join(MOBILE, "android-icon-foreground.png"),
  }),
  square({ crop: FACE, size: 196, out: join(MOBILE, "favicon.png") }),
  rounded({ crop: FACE, size: 1024, out: join(MOBILE, "splash-icon.png") }),

  // Web (Next.js App Router special files + visible logo mark).
  square({ crop: FACE, size: 512, out: join(WEB_APP, "icon.png") }),
  square({ crop: FACE, size: 180, out: join(WEB_APP, "apple-icon.png") }),
  rounded({
    crop: FACE,
    size: 256,
    out: join(WEB_PUBLIC, "sirius-logo-mark.png"),
  }),
]);

console.log("brand icons generated");
