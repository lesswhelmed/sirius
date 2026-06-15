# PROMPT — App Store Readiness Kit for a React Native (Expo) App

You are preparing this **React Native + Expo** app (non-game, latest Expo SDK) for
submission to the Apple App Store via **App Store Connect**. Your job is to produce a
single authoritative markdown file, `APP_STORE_SUBMISSION.md`, that walks a human
through every remaining step to ship the app — assuming they have an Apple Developer
account but NOTHING else verified.

## Operating rules (do not violate)
1. **Validate, never assume.** "Basic setup" is NOT confirmed. For every prerequisite
   (Expo SDK version, EAS CLI, bundle identifier, signing, app.json/app.config keys,
   icons, privacy strings, etc.) you must actually inspect the repo and report the real
   state — found / missing / misconfigured — with the file path and line. Do not write
   "this is probably set up." Check it.
2. **If something is ambiguous or you cannot determine intent, STOP and ASK** the user a
   specific question rather than guessing or substituting your own approach.
3. The deliverable is documentation + the minimal config fixes needed to make the app
   submittable. Do not change app behavior/features. If a code or config change is
   required for store compliance, list it as a discrete, reviewable step.
4. Pin every instruction to the **actual versions** detected in this repo (Expo SDK,
   `eas-cli`, React Native, Xcode/iOS deployment target). No generic "latest" hand-waving.

## Phase 0 — Discover & validate current state (do this first, report findings)
Inspect and report actual values for each:
- `package.json` — Expo SDK version, react-native version, scripts; `eas-cli` availability.
- `app.json` / `app.config.(js|ts)` — `name`, `slug`, `version`, `ios.bundleIdentifier`,
  `ios.buildNumber`, `ios.supportsTablet`, `orientation`, `icon`, `splash`,
  `scheme`, `extra.eas.projectId`, `runtimeVersion`/`updates` config.
- `eas.json` — build profiles (development/preview/production), `submit` config,
  `ios.appleId` / `ascAppId` / `appleTeamId` presence (do not print secrets).
- Signing: is the app linked to an EAS project? Are iOS credentials managed by EAS or
  local? (`eas credentials`) Report which, don't change without asking.
- Required iOS privacy strings in config: every `NS*UsageDescription` for permissions
  the app's dependencies actually use (camera, location, photos, microphone, contacts,
  tracking, notifications, etc.). Cross-check installed native modules against declared
  usage strings and flag mismatches.
- **Privacy manifest** (`PrivacyInfo.xcprivacy`) — present? Does it declare required-reason
  APIs and any data collection / tracking domains? Flag if missing.
- Encryption declaration: `ITSAppUsesNonExemptEncryption` set in config?
- App icon & assets: 1024×1024 marketing icon present and free of alpha/transparency?
  Adaptive/notification icons as needed.
- Permissions/data: enumerate what the app collects to drive the App Privacy
  questionnaire and the privacy policy requirement.
- A prebuild/`expo-doctor` health pass and an `eas build` config sanity check.

Output a **readiness table**: item | required for submission? | current state | action needed.

## Phase 1 — Write `APP_STORE_SUBMISSION.md`
Structure it so a non-expert can follow it top to bottom. Include:

1. **Prerequisites checklist** — Apple Developer Program membership (paid), Apple Team ID,
   App Store Connect access, a Mac only if needed (note EAS builds in the cloud so a Mac
   is optional), Node/Expo/EAS CLI versions detected, logged-in `eas whoami`.
2. **App identity** — final `bundleIdentifier`, app name, `version` (CFBundleShortVersion)
   vs `buildNumber` policy, how to bump them, runtime version strategy.
3. **Create the app record in App Store Connect** — register the bundle ID, create the app,
   set primary language, SKU, category, content rights, age rating questionnaire.
4. **Build for production with EAS** — exact commands (`eas build --platform ios --profile
   production`), credential flow, what to expect, common failure modes + fixes.
5. **Submit the build** — `eas submit --platform ios` (preferred) and the manual
   Transporter alternative; how to attach the build to App Store Connect.
6. **TestFlight** — internal vs external testing, beta review, when it's required.
7. **Store listing / metadata** — name (≤30), subtitle (≤30), promotional text,
   description, keywords (≤100), support URL, marketing URL, **privacy policy URL**,
   copyright, contact info, demo account credentials if there's a login.
8. **Screenshots & previews** — exact required device sizes and pixel dimensions for the
   current App Store Connect requirements (6.9"/6.7" iPhone, 13" iPad if `supportsTablet`),
   how to capture them, do/don't rules (no status-bar clutter, no device frames if not
   allowed). Note any that are mandatory vs optional.
9. **App Privacy ("nutrition label")** — map the data the app actually collects to the
   questionnaire, plus tracking/ATT answers consistent with `PrivacyInfo.xcprivacy`.
10. **Export compliance / encryption** answers.
11. **Pre-submit verification checklist** — every required field non-empty, build processed,
    privacy answers complete, age rating set, screenshots uploaded, no placeholder text.
12. **Submit for review** — manual vs automatic release, phased release, what reviewers
    commonly reject (broken links, login required without demo creds, privacy mismatches,
    crash on launch) and how to preempt them.
13. **Post-submission** — review timeline, responding to rejections, releasing, and how to
    ship updates / OTA updates (EAS Update) vs new binary submissions.

## Output format
- One markdown file: `APP_STORE_SUBMISSION.md`.
- Use checkboxes (`- [ ]`) for every actionable step so the user can track progress.
- Every command in a copyable code block, pinned to detected versions.
- A clearly marked **"⚠️ Needs your input / decisions"** section at the top listing
  anything you could not determine (final app name, category, privacy policy URL, pricing,
  signing ownership) — ask, don't invent.

Begin with Phase 0. Show me the readiness table and the list of open questions BEFORE
writing the full guide.
