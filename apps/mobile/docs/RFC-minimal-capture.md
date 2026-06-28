# RFC: Minimal Capture screen (progressive disclosure)

- **Status:** Implemented (branch `feat/mobile-minimal-capture`)
- **Surface:** `apps/mobile` — Capture tab (`apps/mobile/src/app/(tabs)/composer.tsx`, route `composer`)
- **Scope:** Presentation/layout only. **No** endpoint, payload, worker, DB, or
  classification logic changes.

## Problem (wtf are we fixing)

The Capture tab front-loaded everything at once — an eyebrow + title + 3 toolbar links, an
instructional input card, a Focus chip row, an Audience row, a staging tray placeholder, an
on-device-AI toggle, a usage meter, and a sticky "Process N" bar — **all visible before the
user has added a single thing.** For a general / Gen-Alpha layman audience that reads as a
technical control panel, not "drop something here." There was also a real iOS papercut: the
note input is multiline, and multiline `TextInput` on iOS has **no return-key dismiss and
ignores `inputAccessoryViewID`** — a long note could trap the keyboard with nowhere to tap
out, hiding the very text being written.

## Goal

Make the **rest state minimal** — essentially one input box a newcomer can't misread — and
**progressively reveal** the already-existing refine controls (focus, audience/privacy,
on-device drafting) inline only once the user has added an item. Keep **100% of
functionality**; lose nothing. Keep the submission procedure **byte-for-byte frozen**.

## Design

Editorial-minimal, matching the app's existing aesthetic (cream paper, midnight-navy accent,
EB Garamond serif, Space Mono labels, dashed-border input). Flow prototyped in Stitch
(project `Sirius — Minimal Capture (mobile)` / design system "Inked Parchment"): Rest →
Active-typing (with the DONE accessory bar) → Refine & send.

**Rest state** = slim `Capture.` title · one multiline input · `Add` button · the 5 media
attachment cards · one-line share tip + `How it works →` · disabled "Add something to begin"
bar. Nothing else.

**After the first item (`items.length > 0`)** the staging tray and a new **"Refine & send"**
band unfold inline below the input: Focus chips, Audience row, and the on-device drafting
toggle, above the sticky "Process N" bar.

**iOS keyboard:** reuse the existing `KeyboardDoneButton` (`apps/mobile/src/components/sirius.tsx`,
driven by `useKeyboardVisible`) — already used in the edit/repo sheets but **missing from the
main note input**. It self-gates to iOS + keyboard-up and calls `Keyboard.dismiss()`, so a
long note always has an out and stays visible above the keyboard. Input stays **multiline**
(Return = newline; the `Add` button commits) so notes and multi-URL paste are unaffected.

## Decisions (and the alternatives we rejected)

| Decision | Chosen | Rejected alternative | Why |
|---|---|---|---|
| Reveal model | **Inline** on the same screen | Stepped/wizard bottom sheet | Fewest taps; one scroll; no new navigation surface. |
| Attachments | **Keep 5 cards visible** | Collapse behind one "+/Attach" sheet | Product call — media stays one tap away; rest state is still calm enough. |
| Enter behavior | **Multiline + prominent `Add`** | Single-line, Return submits | Binding Return would break newline entry in notes and readable multi-line paste. |
| Header | **Slim `Capture.` only**, relocate 3 links | Keep eyebrow + toolbar | Removes the "control panel" feel; links live where they're relevant. |
| Keyboard | Reuse `KeyboardDoneButton` | New input-accessory logic | Matches an established in-app precedent; zero new keyboard code. |
| Default Focus chip | **"Auto"** + hint | Leave it "None" | When `projectId` is null the worker **auto-assigns** a focus (see below), so "None" was a lie. "Auto" + a one-line hint tells the user Sirius picks the best focus and they can tap one to override. |

### Focus is auto-assigned, not "none"

Leaving Focus unset does **not** mean no focus. When a submission has `projectId == null`,
`apps/worker/src/pipeline/classification/assign-org.ts` (`assignOrg`, runs right after the
post is written) assigns one: best-match existing project by embedding cosine similarity →
title-match fallback → auto-create a project (+ aspiration, `metadata.autoCreated`). Proven by
`apps/worker/scripts/smoke-assign-org.ts`, which submits with `projectId: null` and asserts a
project was assigned. So the chip now reads **"Auto"** with copy: *"On Auto, Sirius files this
under the best focus for you. Tap one to choose it yourself."* (and the inverse once the user
picks one). Worker behavior is unchanged — this is UI copy that tells the truth.

The 3 toolbar links were **relocated, not deleted**: `How it works →` (under the share tip),
`Manage focus →` (in the Focus block), `On-device AI →` (in the curation ready-branch).

## What stays frozen (explicit non-goals)

`submitMaterials` import + `runSubmit` / `finishSubmit` / `forceReprocess` / `submit`
(including the paywall check and the dedup "Already in your catalog" → "Process again"
Alert), `OmniSubmitBar` + its `onSubmit={submit}` mount, and every classification/registry/
picker handler. The media/audio/repo/edit Sheets and `AudienceSheet` stay mounted and wired.
Verified identical against `main` for the entire pre-`return` region.

## Risks / trade-offs

- **Focus / Audience / on-device toggle now appear only after the first item** (they showed
  on an empty tray before). By design — `submit()` already requires `items.length > 0`, the
  on-device setting persists via `updateLlmSettings` and is also reachable from `/llm`. Low
  risk; flagged as a conscious product call (confirmed in coworker review).
- Pure UI; no data-path risk. Covered by `check-types` + `expo lint` and the manual matrix
  in `VERIFY-minimal-capture.md`.

## References

- Implementation: `apps/mobile/src/app/(tabs)/composer.tsx`
- Reused primitive: `apps/mobile/src/components/sirius.tsx` (`KeyboardDoneButton`, `useKeyboardVisible`)
- Verification + review results: `apps/mobile/docs/VERIFY-minimal-capture.md`
