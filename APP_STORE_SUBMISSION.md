# Sirius — App Store Submission Guide

Everything you need to ship **Sirius** (iOS) to the App Store, written for top-to-bottom
execution. Versions are pinned to what's actually in this repo as of **2026-06-15**.

> **Good news up front:** the technical pipeline is already done. The App Store Connect
> app record exists (`ascAppId 6775729513`), credentials are valid, and there is a
> **FINISHED production build (#24, v1.0.0)** ready to submit. What remains is mostly
> content: privacy/support pages (drafted in this repo — deploy them), listing copy
> (drafted below), screenshots (captured into `app-store-assets/`), a reviewer account,
> and the App Store Connect form-filling + "Submit for Review".

---

## ⚠️ Needs your input / decisions

- [ ] **Deploy the new legal pages.** I added `apps/web/app/(public)/privacy/page.tsx` and
      `…/support/page.tsx`. They must be live at `https://lesswhelmed.com/privacy` and
      `/support` **before** you submit (both currently 404). Deploy with `bun run deploy`.
- [ ] **Create a reviewer account on prod** (the app gates on login). Register a fresh
      account on `https://lesswhelmed.com`, **verify its email**, and confirm it can sign in.
      Put the credentials in App Review notes (section 12). Do not use your personal account.
- [ ] **Confirm the contact email.** The privacy + support pages and the guide use
      `saleebmina@copt.dev`. Change it if you want a dedicated support inbox.
- [ ] **Pick the primary category** (recommended **Productivity**, secondary **Lifestyle** —
      see section 7). Confirm or change.
- [ ] **Confirm the age rating answers** (section 9). The app shows user-generated content;
      answer the questionnaire honestly (likely 4+/12+ depending on UGC answers).
- [ ] **Current ASC state:** a submit already ran on 2026-06-14. Confirm whether an earlier
      build is already "In Review", or whether you want to submit **build #24** fresh.

---

## Detected environment (pinned)

| Tool | Version (this repo) | Source |
|------|--------------------|--------|
| Expo SDK | `56.0.11` | `apps/mobile/package.json`, root `overrides` |
| React Native | `0.85.3` | `apps/mobile/package.json` |
| React | `19.2.3` | pinned in root `overrides` |
| eas-cli | `>= 20.0.0` | `apps/mobile/eas.json` → `cli.version` |
| Node (build) | `22.12.0` | `eas.json` build profiles |
| Bun | `1.3.14` | root `packageManager` |
| iOS deployment target | Expo SDK 56 default (not overridden) | `app.json` |

---

## 1. Prerequisites checklist

- [x] Apple Developer Program membership — Team **`L7U86T3YRV`** (Mina Saleeb, Individual)
- [x] Distribution cert + provisioning profiles on EAS (valid to **2027-06-01**), for both
      `dev.copt.sirius` and `dev.copt.sirius.share-extension`
- [x] Logged into EAS — `minasaleeb` / `saleebmina@copt.dev`
      (verify any time: `cd apps/mobile && bunx eas-cli whoami`)
- [x] App Store Connect access (same Apple ID on the team)
- [ ] A Mac is **optional** — EAS builds in the cloud. You only need a Mac for the
      interactive `eas submit` Apple login (or use an ASC API key for non-interactive).

---

## 2. App identity

| Field | Value |
|-------|-------|
| App name | **Sirius** |
| Bundle ID | `dev.copt.sirius` (+ `dev.copt.sirius.share-extension`) |
| Scheme | `siriusapp` |
| Marketing version (CFBundleShortVersionString) | `1.0.0` (`app.json` → `version`) |
| Build number (CFBundleVersion) | **EAS-managed** (`appVersionSource: remote`, `autoIncrement: true`) — latest is **24** |
| Runtime version | `fingerprint` policy (OTA updates only reach matching native builds) |

**Version policy:** never edit `buildNumber` by hand — EAS owns it. To ship a feature
release, bump `version` (e.g. `1.0.1`) in `app.json`; EAS auto-increments the build number.
For JS-only fixes to an already-shipped binary, use EAS Update (section 13).

---

## 3. App Store Connect app record

**Already created** (first `eas submit` ran 2026-06-14):

- [x] Bundle ID registered: `dev.copt.sirius`
- [x] App record exists — `ascAppId 6775729513` (backfilled into `eas.json` →
      `submit.production.ios.ascAppId`, so future submits are non-interactive)
- [ ] In App Store Connect → **App Information**, confirm: primary language, SKU, bundle ID,
      **content rights** (do you have rights to all content? yes — it's your catalog), and
      category (section 7).

---

## 4. Build for production with EAS

A FINISHED build (#24) already exists — you can skip straight to section 5. Only rebuild if
you've changed code since.

> **Before any rebuild:** `eas.json` sets `requireCommit: true`, so the **git tree must be
> clean**. Right now there are untracked files (`EXPO_APP_STORE_READINESS_PROMPT.md`,
> `docs/vision/`, the new legal pages, this guide, `app-store-assets/`). Commit or stash
> them first, or the build refuses to start.

```sh
# from repo root — the bundled skill script generates Prisma client, typechecks the
# mobile app, asserts a clean tree, kicks the prod build, and polls to completion:
.claude/skills/ios-app-store-deploy/scripts/build-ios-prod.sh

# …or directly:
cd apps/mobile
bunx eas-cli build --profile production --platform ios
```

- [ ] Build reaches **FINISHED** (watch the printed `expo.dev/...builds/...` URL)

**Common failure modes:**
- *Dirty tree* → "requireCommit" error. Commit/stash and retry.
- *"Configure expo-updates" phase error* (seen 2026-06) → usually a duplicate `llama.rn`
  native module. See `HANDOFF-ios-build-failure.md`. Builds #22–24 succeeded, so this is
  currently resolved — don't pre-emptively change the `llama.rn`/provider pinning.
- *Credential errors* → shouldn't happen (managed by EAS); if so, `bunx eas-cli credentials`.

---

## 5. Submit the build to App Store Connect

Because `ascAppId` + `appleTeamId` are in `eas.json`, this is nearly turnkey.

**Preferred — EAS submit (interactive Apple login):**

```sh
cd apps/mobile
bunx eas-cli submit --profile production --platform ios --latest
# or target a specific build instead of --latest:
# bunx eas-cli submit --profile production --platform ios --id df285dbd-eb69-4fa4-b877-b8e5099b855b
```

- [ ] Sign in with the Apple ID on Team `L7U86T3YRV` (+ 2FA)
- [ ] EAS uploads the `.ipa`; ASC then "processes" it (a few minutes to ~1 hr)

**Non-interactive alternative** (if you create an App Store Connect API key — `.p8` + Key ID
+ Issuer ID):

```sh
cd apps/mobile
EXPO_APPLE_API_KEY_PATH=/path/AuthKey_XXXX.p8 \
EXPO_APPLE_API_KEY_ID=XXXXXXXXXX \
EXPO_APPLE_API_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
bunx eas-cli submit --profile production --platform ios --latest --non-interactive
```

**Manual alternative:** download the `.ipa` from the EAS build page and upload via
**Transporter** (Mac App Store). Slower; only if `eas submit` misbehaves.

---

## 6. TestFlight (optional but recommended)

- [ ] Once the build is processed, it appears under **TestFlight**.
- [ ] **Internal testing** (up to 100 users on your team) needs no beta review — fastest way
      to smoke-test the prod binary against `lesswhelmed.com`.
- [ ] **External testing** (public/large groups) requires a one-time **Beta App Review**.
- [ ] Verify on a real device that login works against prod and the main tabs load before
      submitting for App Review.

---

## 7. Store listing / metadata (drafted — edit to taste)

All copy below respects Apple's character limits. Paste into App Store Connect →
**[your app] → [version] → App Store** tab.

> **Positioning:** Sirius is a **personal content catalog** — you capture links, photos,
> notes, repos, videos, documents, and voice memos, AI drafts a clean entry, and you curate
> and publish what you choose. The copy below and the screenshots both reflect that (any
> earlier "militaria broker" framing has been removed from the product).

> **Tip:** each value below is in its own code block — hover it and click the copy icon to
> grab the exact text, then paste it straight into App Store Connect.

**App Name** (≤30):

```text
Sirius
```

**Subtitle** (≤30, this is 27):

```text
Capture, draft, and publish
```

**Promotional text** (≤170, editable without review):

```text
Turn any link, photo, note, or voice memo into a clean, organized post — drafted for you by AI, ready to keep or publish.
```

**Keywords** (≤100, comma-separated, **no spaces**):

```text
capture,notes,bookmark,read later,AI,summary,knowledge,catalog,publishing,links,research,organize
```

**Description** (≤4000):

```text
Sirius turns the things you capture — links, photos, notes, code repositories, videos,
documents, even voice memos — into clean, organized posts, drafted for you by AI.

Capture anything:
• Paste a link to an article, listing, or repo.
• Snap or attach photos.
• Jot a quick note or record a voice memo.

Let it draft for you. Sirius reads what you submitted and writes a structured post — title,
summary, tags, and details — that you review, edit, and keep or publish. On iPhone it can
even draft entirely on-device.

Stay organized:
• Catalog — your full library, from draft to published.
• Queue — watch each capture move from pending to done.
• Tree — explore everything by theme and category, with related posts grouped together.

Your space, your terms:
Keep posts private or publish them to your own catalog. Visitors can reach you through an
inquiry form on your public page.

Sirius does not use third-party advertising or cross-app tracking.
```

**What's New** (≤4000) — for v1.0.0:

```text
First release of Sirius. Capture links, photos, notes, and more; let AI draft a post for you; organize everything; and publish what you choose.
```

**Support URL:**

```text
https://lesswhelmed.com/support
```

**Marketing URL** (optional):

```text
https://lesswhelmed.com
```

**Privacy Policy URL:**

```text
https://lesswhelmed.com/privacy
```

**Copyright:**

```text
2026 Mina Saleeb
```

- **Category:** Primary **Productivity**, Secondary **Lifestyle**
  *(alternatives: Shopping, or Reference — Productivity fits the catalog/inventory workflow best)*
- [ ] All metadata fields filled, no placeholder text

---

## 8. Screenshots & previews

**Required:** one set of **6.9-inch iPhone** screenshots. Uploading 6.9" covers all modern
iPhones — you do **not** need 6.5", and you do **not** need iPad (the app sets no
`supportsTablet`).

- **Exact pixel size:** **1320 × 2868** portrait (also accepted for the 6.9" slot: 1290×2796).
- **Count:** 3–10 per localization (Apple requires at least 1; aim for 3–5 strong ones).
- **Captured for you** into `app-store-assets/screenshots/iphone-6.9/` from an
  iPhone 17 Pro Max simulator (6.9", native 1320×2868). See the manifest in that folder.

Do / don't:
- ✅ Real in-app screens, clean status bar, portrait.
- ✅ You may add a marketing frame/caption, but raw screenshots are accepted as-is.
- ❌ No device bezels that misrepresent the UI, no placeholder/lorem content, no other
     platforms' chrome.

- [ ] Upload the PNGs from `app-store-assets/screenshots/iphone-6.9/` to the 6.9" slot

To re-capture later:

```sh
# boot the 6.9" sim, run the app, then:
xcrun simctl io booted screenshot app-store-assets/screenshots/iphone-6.9/NN-name.png
# verify size:
sips -g pixelWidth -g pixelHeight app-store-assets/screenshots/iphone-6.9/NN-name.png
```

---

## 9. App Privacy ("nutrition label")

Fill App Store Connect → **App Privacy** to match what the app actually collects (consistent
with `apps/web/app/(public)/privacy/page.tsx`). Sirius does **not** track and shows no ATT
prompt → answer **"No"** to tracking.

| Data type | Collected? | Linked to user? | Purpose | Tracking? |
|-----------|:---:|:---:|---------|:---:|
| Contact Info — Email address | Yes | Yes | App Functionality | No |
| Contact Info — Name | Yes | Yes | App Functionality | No |
| User Content — Photos/Videos | Yes | Yes | App Functionality | No |
| User Content — Other (URLs, notes, posts) | Yes | Yes | App Functionality | No |
| Identifiers — User ID | Yes | Yes | App Functionality | No |
| Usage Data — Product Interaction (post views) | Yes | Yes | Analytics | No |

- Diagnostics/Crash data: **not collected** (no crash SDK configured).
- Third-party advertising / data "sold": **No**.
- [ ] App Privacy completed and matches the privacy policy

---

## 10. Export compliance / encryption

- [x] `ITSAppUsesNonExemptEncryption: false` is set in `app.json` (`ios.infoPlist`), so the
      binary declares it uses only exempt encryption (standard HTTPS).
- [ ] In the submission flow, the encryption question is therefore answered automatically as
      **"No"** (uses only exempt/standard encryption). Nothing else to file.

---

## 11. Pre-submit verification checklist

- [ ] `https://lesswhelmed.com/privacy` returns 200 (deployed)
- [ ] `https://lesswhelmed.com/support` returns 200 (deployed)
- [ ] Build #24 (or your chosen build) is **processed** in App Store Connect
- [ ] Screenshots uploaded to the 6.9" slot (1320×2868)
- [ ] Name, subtitle, description, keywords, URLs, copyright all set — no placeholders
- [ ] Category set; age rating questionnaire completed
- [ ] App Privacy completed
- [ ] Export compliance answered (No)
- [ ] Reviewer demo account created on prod, email verified, **tested**, and entered in
      App Review notes
- [ ] App icon shows (1024² no alpha — already in the binary)

---

## 12. Submit for review

In App Store Connect → your version:

- [ ] **App Review Information** → add the reviewer demo account. Copy the notes block below
      (fill in the username/password fields in ASC separately):

```text
Sirius requires an account. Sign in with the demo credentials provided in the Username/Password fields. The app talks to https://lesswhelmed.com. Main flow: Capture tab → paste a URL or add a photo/note → it drafts a catalog entry → review in Catalog → publish.
```
- [ ] Choose release option: **Manual release** (recommended for a first launch so you
      control go-live), Automatic, or Phased.
- [ ] Click **Add for Review → Submit**.

**What reviewers commonly reject (preempt these):**
- Login wall with no working demo account → covered by the reviewer account above.
- Broken privacy/support URLs → deploy the pages first (section 11).
- Privacy label not matching actual data use → section 9 mirrors the policy.
- Crash on launch → smoke-test via TestFlight (section 6) first.
- Guideline 2.1 incomplete metadata / placeholder content → checklist in section 11.

---

## 13. Post-submission

- **Review timeline:** typically 24–48 hours; first submissions can take longer.
- **If rejected:** read the Resolution Center message, fix the specific issue, reply or
  resubmit. Most rejections are metadata/demo-account/privacy issues, not the binary.
- **Releasing:** if you chose Manual release, click **Release** once "Pending Developer
  Release."
- **Shipping updates:**
  - *JS-only change* (no native deps changed) → **EAS Update** (OTA), no re-review:
    ```sh
    cd apps/mobile && bunx eas-cli update --branch production
    ```
    (Only reaches builds with a matching native fingerprint.)
  - *Native change or App Store metadata change* → bump `version`, new
    `eas build --profile production --platform ios`, `eas submit`, new review.

---

## Appendix — files added/changed in this repo for submission

- `apps/web/app/(public)/privacy/page.tsx` — Privacy Policy page (deploy → `/privacy`)
- `apps/web/app/(public)/support/page.tsx` — Support page (deploy → `/support`)
- `app-store-assets/screenshots/iphone-6.9/` — 6.9" screenshots (1320×2868) + manifest
- `APP_STORE_SUBMISSION.md` — this guide

No app behavior/feature code was changed.
```
