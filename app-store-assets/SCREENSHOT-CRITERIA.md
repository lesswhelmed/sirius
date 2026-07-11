# App Store screenshot verification criteria

Each captured screenshot is verified by a single-image subagent that views **one**
PNG and checks it against (1) the universal criteria below and (2) the criteria for
that specific screen. **PASS requires 100% of the applicable criteria.** Any miss is
a FAIL with a specific reason, and the screen is recaptured before shipping.

Resolution is verified mechanically with `sips` (not by the vision subagent):
native iPhone 15 Plus capture is **1290 × 2796**; the App Store 6.5" deliverable is
normalized to **1284 × 2778**.

## Universal criteria (every screenshot)

- U1. Clean status bar: time reads **9:41**, full cellular/Wi‑Fi bars, battery 100%.
- U2. **No "◀ AgentDeviceRunner" (or any "◀ <app>") return chip** in the top-left
  status bar. This is the single most common defect — automation leaves it behind.
- U3. No error UI: no red box, no yellow LogBox warning, no toast containing
  "Uncaught", "Error", "fetch failed", "certificate", or a stack trace.
- U4. No mid-load state: no spinners, skeletons, greyed placeholders, or empty
  content wells in the primary content area.
- U5. Portrait orientation, app chrome fully rendered (tab bar present where the
  screen has one), nothing clipped at the safe-area edges.

## Per-screen criteria

### 01-onboarding (`siriusapp://help`)
- O1. Header reads **"How Lesswhelmed works."** with the "Welcome" eyebrow.
- O2. The subtitle about sharing to Sirius is visible.
- O3. The "The one move to learn" section with numbered step cards
  (Open anything → Tap Share → Pick Sirius) is visible.
- O4. Scrolled to the very top (header fully visible, not cut off).

### 02-capture (`siriusapp://composer`)
- C1. Capture headline (**"Capture."**) visible.
- C2. The capture-source options (links, note, photos, video, document, etc.)
  are visible as tappable rows/buttons.
- C3. Capture tab is the active tab in the tab bar.

### 03-catalog (`siriusapp://library`)
- L1. Header reads **"The Catalog."**
- L2. Shows **6 posts**, scrolled to the top (header + first posts visible).
- L3. **Every visible post has a real photographic cover thumbnail** — NOT a letter
  monogram / initial placeholder. (This is the whole point of the cover backfill.)
- L4. Post titles are legible and match the demo library (Pour-Over Ritual, Ridge
  Trail Day Hike, Reading Note: Deep Work, Sourdough Starter, Desk Setup, City
  Library).
- L5. Catalog tab active in the tab bar.

### 04-friends (`siriusapp://feed`)
- Q1. Friends feed header visible ("Friends." / SHARED).
- Q2. Shows shared posts in the feed (the seeded demo friends' FRIENDS posts),
  not an empty "nothing here yet" state.
- Q3. Friends tab active in the tab bar.

### 05-post-detail (`siriusapp://post/ridge-trail-day-hike`)
- D1. Shows the **Ridge Trail Day Hike** post.
- D2. The **hero cover image is the ridge-trail hike photo** (wildflowers + a
  trail along golden hills) — not a beach, not a monogram, not missing.
- D3. Post title + body/excerpt text legible.

### 06-explore-categories (`siriusapp://tree`, Topics/Categories view)
- E1. Explore/Tree screen with the taxonomy outline (categories/topics list) OR the
  "Focus areas" section, populated (not empty).
- E2. Explore tab active in the tab bar.

### 07-explore-map (`siriusapp://tree`, Map view)
- M1. The Map / 3D embedding view is rendered with visible nodes (not a blank
  canvas, not still loading).
- M2. Explore tab active in the tab bar.
