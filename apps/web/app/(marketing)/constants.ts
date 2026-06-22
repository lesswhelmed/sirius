// Shared constants for the marketing surface.

// App Store record (ascAppId from the submission kit). Links to the iOS listing.
export const APP_STORE_URL = "https://apps.apple.com/us/app/sirius-ai/id6775729513";

// Demo video assets exist under public/product/ (demo.mp4 + demo.webm +
// poster.jpg). The hero now runs an auto-cycling screenshot carousel instead
// (HeroCarousel) — set this true to fall back to the legacy looping video.
export const DEMO_VIDEO_READY = false;

export const DEMO_VIDEO = {
  mp4: "/product/demo.mp4",
  webm: "/product/demo.webm",
  poster: "/product/poster.jpg",
} as const;

// Real in-app screenshots copied into public/product/screens/.
export const SCREENS = {
  capture: "/product/screens/01-capture.png",
  catalog: "/product/screens/02-catalog.png",
  queue: "/product/screens/03-queue.png",
  tree: "/product/screens/04-tree.png",
  post: "/product/screens/05-post-detail.png",
  explore: "/product/screens/06-explore.png",
} as const;

// The hero carousel sequence — a genuine capture→keep arc, so the roman folios
// encode real order. Each slide is one real in-app screenshot with a terse mono
// caption. Order mirrors the "How it works" flow plus the live queue.
export const SCREEN_SLIDES = [
  {
    folio: "I",
    label: "Capture",
    src: SCREENS.capture,
    alt: "The Sirius capture screen",
  },
  {
    folio: "II",
    label: "Draft",
    src: SCREENS.post,
    alt: "A finished post, drafted by AI",
  },
  {
    folio: "III",
    label: "Organize",
    src: SCREENS.tree,
    alt: "The Tree — everything sorted by theme",
  },
  {
    folio: "IV",
    label: "Explore",
    src: SCREENS.explore,
    alt: "The Observatory — your space mapped by meaning",
  },
  {
    folio: "V",
    label: "Publish",
    src: SCREENS.catalog,
    alt: "Your catalog of kept entries",
  },
  {
    folio: "VI",
    label: "In flight",
    src: SCREENS.queue,
    alt: "The live queue as captures process",
  },
] as const;
