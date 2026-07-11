// Shared constants for the marketing surface.

// App Store record (ascAppId from the submission kit). Links to the iOS listing.
export const APP_STORE_URL = "https://apps.apple.com/us/app/sirius-ai/id6775729513";

// Official Apple "Download on the App Store" badge (fetched from Apple's
// marketing toolbox, unmodified per their brand guidelines — it keeps its own
// rounded corners, the one intentional exception to our zero-radius rule).
export const APP_STORE_BADGE = "/product/app-store-badge.svg";

// Shared caption under the CTA block — the primary path is web sign-up; the
// native app is iOS-only, so we say so plainly.
export const CTA_CAPTION = "iOS app · also on the web · No tracking";

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
  friends: "/product/screens/03-friends.png",
  tree: "/product/screens/04-tree.png",
  post: "/product/screens/05-post-detail.png",
  explore: "/product/screens/06-explore.png",
} as const;

// The hero carousel sequence — a genuine capture→keep arc, so the roman folios
// encode real order. Each slide is one real in-app screenshot with a terse mono
// caption. Order mirrors the "How it works" flow plus the shared Friends feed.
export const SCREEN_SLIDES = [
  {
    folio: "I",
    label: "Capture",
    src: SCREENS.capture,
    alt: "The Lesswhelmed capture screen",
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
    label: "Share",
    src: SCREENS.friends,
    alt: "The Friends feed — posts your friends shared with you",
  },
] as const;
