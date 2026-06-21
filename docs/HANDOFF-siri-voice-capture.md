# Hands-free Siri voice capture

Say a phrase to Siri → Siri asks "What would you like to capture?" → you dictate → it
lands in your capture queue as a note/BLOG submission, attributed to you, **without the
app opening**. Siri's own dictation is the microphone; no audio file is recorded for this
path (the in-app composer recorder still exists for longer memos).

## How it works

- **`apps/mobile/ios-intents/QuickCaptureIntent.swift`** — background App Intent
  (`openAppWhenRun = false`). Prompts for the `note` parameter by voice, then POSTs
  `{ "notes": <text> }` to `<baseUrl>/api/app/ingest` with the session `Cookie` header
  (`httpShouldHandleCookies = false`, mirroring the JS client). On success it speaks
  "Added to your Sirius queue."
- **Credential bridge.** The signed-in cookie is mirrored into a plain app keychain item
  (service `dev.copt.sirius.capture`, account `session`) by the local Expo module
  **`apps/mobile/modules/sirius-capture`** (`setCredentials`/`clearCredentials`), driven
  from JS in **`src/lib/capture-credentials.ts`**. It's written on login + every confirmed
  session re-check (`SyncRunner` in `src/app/_layout.tsx`, `checkServerSession` in
  `src/lib/api.ts`) and cleared on sign-out. The intent reads the same item via
  **`ios-intents/SiriusCredentialStore.swift`**. No App Group / keychain-sharing needed —
  a main-app App Intent runs in the app's own process, so it shares the default keychain.
- **Fallback.** Missing/expired cookie or a failed request → the intent opens
  `siriusapp://capture?text=<text>&autosubmit=1`; `src/app/capture.tsx` auto-submits once a
  session is present (no lost text).
- **Custom phrase.** Settings → "Hands-free capture" → "Set up Siri capture" opens the
  Shortcuts app, where the user records ANY phrase against the "Quick Capture" action
  (Apple forces the app name into *built-in* phrases — `SiriusShortcuts.swift` ships
  cleaner ones like "Quick note in Sirius app" via `CFBundleSpokenName` — but a
  user-recorded phrase has no such constraint).

## This is a NATIVE change — no OTA

Swift files + `app.json` infoPlist + a new local module all change the native binary.
A clean prebuild + on-device build is required. `bun run dev` auto-detects the native
input change (`prebuild-if-native-changed.mjs`); EAS builds stay gated by
`bun run verify:native-ai`.

## Device test runbook (real device, signed in)

1. Build + install; sign in so the credential bridge writes the keychain item.
2. **Hands-free:** lock the phone → "Hey Siri, Quick note in Sirius app" → Siri asks
   "What would you like to capture?" → speak a sentence → expect spoken "Added to your
   Sirius queue" and **the app does NOT open**. Open the app → Queue → the note is there,
   attributed to you; the worker drafts it into a BLOG post.
3. **Custom phrase:** Settings → Set up Siri capture → in Shortcuts record "note to self"
   on Quick Capture → say it hands-free → same result.
4. **Fallback:** sign out (clears the keychain) → say the phrase → confirm it **opens the
   app** to `capture?...&autosubmit=1` and auto-queues after sign-in, text intact.
5. **Attribution:** the resulting `IngestSubmission`/`Post` has `submittedById` set (it
   used the session path, not a tokenless bearer submit).

## Open considerations

- `NSSpeechRecognitionUsageDescription` is declared even though Siri does the dictation
  natively (the app doesn't call `SFSpeechRecognizer`). Harmless, but if App Review
  questions an unused permission it can be removed from `app.json`.
- `UIApplication.shared.open` is called from the background intent for the fallback. It's
  the same API the existing open-app intent uses; if iOS ever declines it from the
  background, the spoken dialog still tells the user to retry.
