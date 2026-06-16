// Shared constants for the marketing surface.

// App Store record (ascAppId from the submission kit). Links to the iOS listing.
export const APP_STORE_URL = "https://apps.apple.com/app/id6775729513";

// Demo video assets exist under public/product/ (demo.mp4 + demo.webm +
// poster.jpg). Set false to fall back to a static hero screenshot.
export const DEMO_VIDEO_READY = true;

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
} as const;
