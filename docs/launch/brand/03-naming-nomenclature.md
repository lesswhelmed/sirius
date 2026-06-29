# Sirius — Naming & Nomenclature

_The canonical spelling, capitalization, and naming rules for everything Sirius. When a name is in question, this file is the answer. Last updated 2026-06-29._

---

## I. The hero name

**Sirius** is the single hero brand — the name of **both the product and the company.**

| Use | Canonical form | Notes |
| --- | --- | --- |
| Company | **Sirius** | Initial cap only. |
| Product | **Sirius** | Initial cap only. |
| Wordmark | **Sirius** | Never "SIRIUS", never "sirius". |
| App Store name | **Sirius** | The store listing title. |
| Domain | **lesswhelmed.com** | All lowercase. |
| Email | **name@lesswhelmed.com** | e.g. hello@lesswhelmed.com. |

**Rule:** write **Sirius** with an initial capital and the rest lowercase, always. Do not stylize it (no all-caps, no special characters, no "Sirius™" in body copy).

---

## II. "lesswhelmed" usage rules

`lesswhelmed` is **not a brand.** It survives in exactly two roles:

1. The **domain**: lesswhelmed.com (and the email domain, @lesswhelmed.com).
2. The **emotional promise**: "Feel lesswhelmed."

**Rules:**
- Always **lowercase** — `lesswhelmed`, never "Lesswhelmed" or "LessWhelmed", even at the start of a sentence (rephrase to avoid sentence-initial position, or write "lesswhelmed.com").
- **Never a co-brand.** Forbidden: "Sirius by Lesswhelmed", "Sirius — a Lesswhelmed app", "Lesswhelmed Sirius", "from the makers of Lesswhelmed".
- It's a feeling and a URL. Treat it like one.

---

## III. App surfaces (UI labels vs. routes)

The mobile app's **UI labels do not always match internal route names.** For brand and docs, **use the UI label.** Internal routes are for engineers only.

| UI label (use this) | Internal route | What it is |
| --- | --- | --- |
| **Capture** | `composer` | Get anything into Sirius. |
| **Catalog** | `library` | Your whole private library, draft → published. |
| **Friends** | `feed` | The shared-posts hub + merged feed. (`friends` route = the off-tab People manager.) |
| **Explore** | `tree` | The taxonomy outline + 3D map (native counterpart of web's Observatory). |
| **Queue** | `queue` | The live processing state machine. |
| **Account** | `settings` | Account and settings. |

**Capitalization:** all six are **proper nouns** — capitalize them (Capture, Catalog, Friends, Explore, Queue, Account).

**Web parallel:** the web "Observatory" lives at `/space`. **Explore** (mobile Tree tab) and **Observatory** (web) are the same idea on two surfaces — see naming for "the Tree / the Observatory" below.

> Engineering note, not for marketing: there is **no `/explore` route** — the Explore tab is `siriusapp://tree`. The URL scheme is **`siriusapp://`** (the bundle id `dev.copt.sirius` is for tooling, not a deep-link scheme). The full route map is `apps/mobile/docs/ROUTES.md`.

---

## IV. Feature & concept names

| Name | Canonical form | Definition |
| --- | --- | --- |
| **Life Context** | Capitalized | The accumulated private context Sirius builds from everything you capture. The moat. |
| **the Loop** | "the Loop" / "close the loop" | The path from inputs → drafts → organization → action. "Closing the Loop" is the automation **north star** — never call it shipped. |
| **the Observatory** | Capitalized | The web corpus-map surface (`/space`). |
| **the Tree** | Capitalized | The mobile Explore tab — native counterpart of the Observatory. |
| **the Catalog** | Capitalized | Your private library. |
| **the Queue** | Capitalized | The processing state machine. |
| **Friends hub / shared feed** | Capitalize "Friends" | The merged shared-posts surface, separate from the Catalog. |
| **MCP corpus server** | lowercase "corpus server", uppercase "MCP" | Per-user API-key access to expose your corpus to external AI agents. |

### Post types

Auto-classified, capitalized as type names: **Finding** (from URLs), **Sight** (from image batches), **Blog** (from notes), plus the social/video paths (Instagram, YouTube).

### Tiers

| Tier | Canonical form | Notes |
| --- | --- | --- |
| Free tier | **Free** | Includes an AI-draft cap. (ASSUMPTION for modeling: ~10 AI drafts/week.) |
| Paid tier | **Pro** | The RevenueCat-backed subscription. Write "upgrade to Pro." |

---

## V. Visibility / audience terms

Per-post visibility is one of four named audiences. Capitalize them as set values:

| Audience | Meaning |
| --- | --- |
| **Private** | Only you. (Default.) |
| **Friends** | Your mutual friends. |
| **Group** | A named friend-group you created. |
| **Public** | Anyone (optional public catalog at `/catalog/[handle]`). |

---

## VI. User identity conventions

- **Handle:** written with a leading `@` in UI and copy — e.g. **@mina.** A user's public catalog lives at **lesswhelmed.com/catalog/[handle]**, and their public landing at **/u/<handle>**.
- **Email:** team and correspondence addresses are **name@lesswhelmed.com.**
- **Proposed social handles** (ASSUMPTION — confirm availability before claiming): prefer **@sirius** where available, else **@trysirius** or **@siriusapp**. Keep it consistent across platforms. Do **not** use a "lesswhelmed" social handle — it would read as a co-brand.

---

## VII. Third-party marks

- **Apple "Download on the App Store" badge:** use Apple's official badge, in its official styling, **with its own rounded corners** (the one exception to Sirius's zero-radius rule — see [Visual Identity §VIII](./02-visual-identity.md)). Never restyle, recolor, or square it.
- Other third-party names (Gemini, RevenueCat, MCP, YouTube, Instagram) are written in their owners' canonical form and only where factually accurate.

---

## VIII. Quick glossary (cite this)

- **Sirius** — the product and the company. Initial cap only.
- **lesswhelmed** — the domain (lesswhelmed.com) and the promise ("Feel lesswhelmed"). Lowercase, never a co-brand.
- **Your life, in context.** — the brand line.
- **Feel lesswhelmed.** — the emotional payoff.
- **Life Context** — accumulated private context; the moat.
- **the Loop** — inputs → drafts → organization → action; "closing the Loop" is the roadmap north star.
- **Capture / Catalog / Friends / Explore / Queue / Account** — the six app surfaces (UI labels, capitalized).
- **the Observatory** (web) / **the Tree** (mobile) — the corpus map.
- **Finding / Sight / Blog** — auto-classified post types.
- **Free / Pro** — the tiers.
- **Private / Friends / Group / Public** — the four post audiences.
- **MCP corpus server** — per-user, key-gated corpus access for external AI agents.

See siblings: [Brand Strategy](./00-brand-strategy.md) · [Messaging Framework](./01-messaging-framework.md) · [Visual Identity](./02-visual-identity.md).
