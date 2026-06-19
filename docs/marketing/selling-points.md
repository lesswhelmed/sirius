# Sirius — Selling points

_Reusable marketing copy for the product page, App Store, and social. Last updated 2026-06-15._

Sirius is a **personal content catalog**. You capture anything — links, photos, notes, code
repositories, videos, documents, even voice memos — and AI drafts a clean, structured post.
You review it, then keep it private or publish it to your own catalog. On iPhone it can draft
entirely on-device.

---

## Taglines (pick one for the hero; rest are alternates)

- **Everything you capture, drafted into something worth keeping.** ← primary
- Capture anything. Sirius drafts the rest.
- Capture now. Sorted later.
- Throw it in. Get back a clean post.

## Punchy hooks (page bands, social, App Store promo)

1. **Capture now. Sorted later.**
2. **AI drafts it. You decide what's worth keeping.**
3. **Your stuff — drafted, organized, and still yours.**
4. **From scattered links to a real catalog.**
5. **Save the thought. Skip the busywork.**
6. **A field journal for everything you capture.**
7. _(internal candidate, not for the public page)_ "The Tinder of your brain dump."

## Elevator pitch (≈40 words)

You collect more than you can keep up with — links, screenshots, half-formed notes. Sirius
takes whatever you throw at it and drafts a clean, organized post with AI. You review, then
keep it private or publish it. Your catalog, your terms.

---

## Feature → benefit → proof

| Feature                                                                            | What you get                                                                                         | Why it's believable (proof)                                                                                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Capture anything** — links, photos, notes, repos, videos, documents, voice memos | One inbox for every kind of thing you want to remember                                               | Capture tab + iOS share sheet; the worker routes each kind through a tailored pipeline (URL, Instagram, YouTube, image batch, note) |
| **AI drafting**                                                                    | Raw input becomes a structured post — title, summary, tags, and details — instead of a dead bookmark | Gemini pipeline with schema-validated output; you always review before it's kept                                                    |
| **On-device drafting (iPhone)**                                                    | Draft privately on your phone, even without a round-trip to a server                                 | Runs a local model on-device (llama.rn) in the iOS app                                                                              |
| **Catalog**                                                                        | Your whole library in one place, from draft to published                                             | Catalog tab / public `/catalog/[handle]`                                                                                            |
| **Queue**                                                                          | See each capture move from pending → processing → done, nothing lost                                 | Queue tab backed by the live ingest state machine                                                                                   |
| **Tree / Observatory**                                                             | Explore everything by theme and category, with related posts grouped together                        | Tree tab + web `/space`, fed by content embeddings                                                                                  |
| **Your data, your terms**                                                          | Originals are retained privately and you can export everything you've put in                         | Private originals store + one-tap archive/export from Settings (emailed download)                                                   |
| **Privacy by design**                                                              | No third-party advertising, no cross-app tracking                                                    | Stated in the privacy policy; the app ships no ad/tracking SDKs                                                                     |
| **Publish or keep private**                                                        | Share to your public catalog when you want — or don't                                                | Per-post visibility; public page carries an inquiry form for visitors                                                               |

---

## Objection handling (quick answers)

- **"Isn't this just another notes app?"** Notes apps store what you type. Sirius turns what you
  _capture_ into a finished, organized post for you — and groups it with everything related.
- **"Do I lose control of my stuff?"** No. Originals are kept privately, you can export
  everything, and nothing is published unless you choose to publish it.
- **"Is my data sold or tracked?"** No third-party ads, no cross-app tracking.
- **"Does it work offline?"** On iPhone, drafting can run on-device.

## Proof points / numbers to drop in (fill when available)

- Formats supported out of the box: **7** (links, photos, notes, repos, videos, documents,
  voice memos).
- Time from capture to a reviewable draft: _measure and insert_.
- Platforms: **iOS + web**.
