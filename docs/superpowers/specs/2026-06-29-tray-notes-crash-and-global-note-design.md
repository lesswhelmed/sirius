# Tray-note crash fix + global submission note

## Problem

**A. Double-modal crash on tray edit.** Tapping a staged card's edit pencil while the "In tray" review sheet is open presents a second React Native `<Modal>` on top of the first, which wedges/crashes the app on iOS and afterward leaves the ingest page nonresponsive (the Review & send wizard can no longer present).

Verified evidence:
- The shared `Sheet` is a React Native `<Modal>` — `apps/mobile/src/components/sirius.tsx:577` (`export function Sheet`), returning `<Modal …>` at `apps/mobile/src/components/sirius.tsx:624`. Its own header comment warns that "presenting while the modal is still dismissing wedges the app" (`sirius.tsx:587-590`, and the dismiss-paths comment `sirius.tsx:573-576`).
- The "In tray" review sheet is one `Sheet`/Modal: `apps/mobile/src/app/(tabs)/composer.tsx:1062-1066` (`visible={itemsSheetOpen}`).
- Its cards' edit pencil: `omni-tray.tsx` `CardIconButton` `onPress={onEdit}` at `apps/mobile/src/components/omni-tray.tsx:238-244`, wired from `SmartCard onEdit={() => openEdit(item.id)}` at `composer.tsx:1084`.
- `openEdit` (`composer.tsx:320-331`) sets `editingId`, which opens a **second** `Sheet`/Modal — the edit sheet at `composer.tsx:993-1051` (`visible={editingId !== null}`, `composer.tsx:994`).
- Two `Sheet` Modals are then visible at once. The Review & send wizard Modal (`composer.tsx:1095-1098`, `visible={reviewStep !== null}`) is a third Modal (a raw `<Modal>`, not a `Sheet`) that can't present afterward.
- `editingItem` is derived at `composer.tsx:714-716`; `confirmEdit` at `composer.tsx:333-384` (file-kind note path writes `notesById` at `composer.tsx:373-379`).

**B. No whole-submission note.** The wizard's Focus step (`composer.tsx:1198-1337`) only offers a focus radio list (Auto row `1244-1268`, project rows `1271-1290`). There is no way to attach a single note that describes the whole submission; the only note affordance is the per-card edit, and for url/text cards that pencil edits the content itself, not a note. Every `Material` kind already carries an optional `notes` field (`materials.ts:41,46,53,62,69,76`) and the submit path already plumbs notes, so the capability exists but is unreachable from the wizard.

**C. Image-batch note collapse.** An image batch is one SIGHT post but `materials.ts:518` resolves the batch note as `const notes = materials.find((m) => m.notes)?.notes ?? ""` — it silently keeps only the **first** image's note and discards every other photo's note.

**D. Note-kind silently drops its `notes` arg.** `toMaterial`'s `note` case returns `{ kind: "note", text: … }` and ignores the `notes` parameter entirely (`apps/mobile/src/lib/omni-ingest.ts:111-112`); `NoteMaterial` has no `notes` field (`materials.ts:47`). So without an explicit merge, a global note attached to a typed-note (BLOG) item would be lost. The existing merge format lives in `applyNote` (`materials.ts:233-245`, `Author's notes: …` at `materials.ts:240`).

## Root cause

Two RN `<Modal>` instances presented simultaneously on iOS. The tray edit was designed as its own `Sheet` (`composer.tsx:993-1051`) layered over the already-open "In tray" `Sheet` (`composer.tsx:1062-1066`), violating the single-modal contract the `Sheet` component itself documents (`sirius.tsx:587-590`).

## Design

### Unit 1 — Inline tray edit (kills the second modal)

Never stack modals. Move the per-card edit **inline into the existing "In tray" Sheet**.

- **Delete** the standalone edit `Sheet` block at `composer.tsx:993-1051`. `editingId`/`editDraft` state, `openEdit` (`320-331`), `confirmEdit` (`333-384`), and `editingItem` (`714-716`) are all retained.
- In the "In tray" list map (`composer.tsx:1071-1091`), render conditionally per row:
  - When `editingId === item.id`: render an **inline edit row** in place of the `SmartCard` — a `Field` (the same input the deleted sheet used: label/placeholder/`multiline`/`keyboardType` derived from `editingItem.kind` exactly as `composer.tsx:1006-1029`), plus inline **Save** (calls `confirmEdit`) and **Cancel** (`setEditingId(null); setEditDraft("")`) controls and a `KeyboardDoneButton`.
  - Otherwise: render the existing `SmartCard` unchanged. `onEdit={() => openEdit(item.id)}` now swaps that card into inline edit mode (no new modal).
- `SmartCard` (`omni-tray.tsx:166`) is **unchanged**; the inline editor lives in `composer.tsx`'s map so `omni-tray.tsx` stays presentational.
- This fixes edit for **all** kinds — url (re-derive/re-validate), text (re-validate), and file (writes `notesById`) — via the existing `confirmEdit` branches (`composer.tsx:342-380`).

### Unit 2 — One-modal guard

Guarantee only one `Sheet`/Modal is ever visible.

- `TrayBar onSend` (`composer.tsx:878`) becomes `() => { setEditingId(null); setItemsSheetOpen(false); setReviewStep(1); }` — opening the wizard first closes the items sheet and any inline edit.
- `TrayBar onReview` (`composer.tsx:877`) stays `() => setItemsSheetOpen(true)`; the items-sheet `onClose` (`composer.tsx:1065`) also clears `editingId` so a half-finished inline edit never lingers.

### Unit 3 — V2 Tabbed Focus step ([ FOCUS | NOTE ])

On the wizard's Focus step (`reviewStep === 2`, `composer.tsx:1198`), add a slim segmented header above the `Title` ("File it under", `composer.tsx:1200-1202`).

- New state (with the other wizard state near `composer.tsx:155-156`):
  - `const [refineTab, setRefineTab] = useState<"focus" | "note">("focus");`
  - `const [submissionNote, setSubmissionNote] = useState("");`
- Segmented header: a hairline-framed 2-segment control `[ FOCUS | NOTE ]`, Space Mono uppercase labels (reuse the mono token used by `wizStepText`/`focusRecTag`, `t.font.mono` — `composer.tsx:1830,1884`), terracotta `t.color.accent` for the active segment, 0px corners, no shadow.
- `refineTab === "focus"`: render today's focus content unchanged (search box `1207-1241`, Auto row `1244-1268`, project rows `1271-1290`, create/empty/error/manage `1292-1336`).
- `refineTab === "note"`: render a framed hairline text area (`multiline`, `textAlignVertical: "top"`, reuse the `editInput` style shape at `composer.tsx:1935`) bound to `submissionNote`, placeholder **"What interests you about this…"** (matching the existing file-note placeholder at `composer.tsx:1020`), plus a `KeyboardDoneButton`.
- Wizard chrome is untouched: the wizard header — back chevron (`composer.tsx:1102-1124`) + step dots (`composer.tsx:1125-1131`) — and the terracotta footer "Process N items" (`composer.tsx:1356-1366`).
- Visual language "Sirius Dark": midnight navy surfaces, EB Garamond (`t.font.serif`) headlines, Space Mono (`t.font.mono`) uppercase labels, terracotta accent, sharp corners, hairline rules, no shadows.

### Unit 4 — Global note data flow (precedence + threading)

Scope = whole submission: the note attaches to every staged item (url→FINDING, photos→SIGHT, typed→BLOG). Per-item tray note **overrides** the global note for that item.

- Thread `submissionNote` into `toMaterialPairs` (`apps/mobile/src/lib/omni-ingest.ts:134-146`) as a new parameter, and resolve per item:
  `const note = notesById.get(item.id)?.trim() || submissionNote.trim() || undefined;` (replaces the current `omni-ingest.ts:141`). `toMaterials` (`omni-ingest.ts:149-155`) gains the same param and forwards it.
- Call site `composer.tsx:670` becomes `toMaterialPairs(items, registry, notesById, submissionNote)`.
- **Note-kind merge** (Unit/Problem D): in `toMaterial`'s `note` case (`omni-ingest.ts:111-112`), when a resolved `notes` is present, merge it into text using the existing format — `text: notes ? `${base}\n\nAuthor's notes: ${notes}` : base` (mirrors `applyNote`, `materials.ts:240`) — since `NoteMaterial` carries no `notes` field. A note-kind item has no `notesById` entry (its inline edit changes text), so its resolved note is the global note.

### Unit 5 — Honest image-batch note

Redefine the batch note at `materials.ts:518` so no photo's note is silently dropped:
`const notes = Array.from(new Set(materials.map((m) => m.notes?.trim()).filter(Boolean))).join("\n\n");`
Distinct per-photo notes are joined; when every image carries the same threaded global note the `Set` collapses it to one; an all-empty batch yields `""`. Result feeds the single SIGHT draft (`draftSightPost`, `materials.ts:524-530`) and the per-image upload `notes` param (`materials.ts:559`).

### Unit 6 — State reset

In `finishSubmit` (`composer.tsx:630-647`, alongside `setNotesById(new Map())` at `638`), add `setSubmissionNote("")` and `setRefineTab("focus")` and `setEditingId(null)` so a fresh capture starts clean.

## Data flow

1. User stages items → optionally edits a per-card note inline in the "In tray" Sheet (Unit 1) → `notesById`.
2. User taps Review & send → items sheet closes, wizard opens (Unit 2). Step 1 = audience; Step 2 = `[ FOCUS | NOTE ]` (Unit 3). The NOTE tab writes `submissionNote`.
3. `submissionNote` is component state, persists across back/forth between Step 1 ↔ Step 2 and FOCUS ↔ NOTE; only cleared in `finishSubmit` (Unit 6).
4. On submit, `toMaterialPairs(items, registry, notesById, submissionNote)` resolves each item's note (Unit 4). **Precedence: per-item `notesById` overrides global `submissionNote`; empty → `undefined` (note omitted).**
5. url/repo/file materials carry resolved `notes`; note-kind merges resolved note into text. Image batch collapses to a deduped joined note (Unit 5). Existing `submit.ts` plumbing carries notes to the worker unchanged.

## Files & changes

| File | Lines | Change |
| --- | --- | --- |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 993-1051 | Delete the standalone edit `Sheet` (the second modal). |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 1071-1091 | In the "In tray" list, render inline edit row when `editingId === item.id` (Field + inline Save/Cancel + KeyboardDoneButton), else `SmartCard` unchanged. |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 1065 | Items-sheet `onClose` also `setEditingId(null)`. |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 878 | `onSend` → `setEditingId(null); setItemsSheetOpen(false); setReviewStep(1)` (one-modal guard). |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 155-156 | Add `refineTab` + `submissionNote` state. |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 1199-1206 | Add `[ FOCUS | NOTE ]` segmented header above the Step-2 `Title` (1200-1202). |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 1199-1337 | Wrap focus content under `refineTab === "focus"`; add NOTE tab framed text area bound to `submissionNote`. |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 670 | `toMaterialPairs(items, registry, notesById, submissionNote)`. |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 638 | In `finishSubmit` add `setSubmissionNote("")`, `setRefineTab("focus")`, `setEditingId(null)`. |
| `apps/mobile/src/app/(tabs)/composer.tsx` | 1828-1843 | Add segmented-control styles near the wizard step styles (mono uppercase, accent active, hairline, 0px). |
| `apps/mobile/src/lib/omni-ingest.ts` | 111-112 | Note-kind: merge resolved `notes` into text (`Author's notes:` format). |
| `apps/mobile/src/lib/omni-ingest.ts` | 134-146 | `toMaterialPairs(items, registry, notesById, submissionNote)`; resolve `notesById.get(id)?.trim() || submissionNote.trim() || undefined`. |
| `apps/mobile/src/lib/omni-ingest.ts` | 149-155 | `toMaterials` forwards new `submissionNote` param. |
| `apps/mobile/src/lib/materials.ts` | 518 | Batch note = deduped non-empty per-photo notes joined `\n\n` (else `""`). |

## Edge cases & error handling

- **Empty global note** → resolved to `undefined`; never send empty strings. NOTE tab whitespace-only is `.trim()`-ed away.
- **Precedence**: per-item tray note (`notesById`) always wins over `submissionNote` for that item.
- **Note survives navigation**: `submissionNote` lives in component state, untouched by `setReviewStep`/`setRefineTab`; only reset in `finishSubmit`.
- **Inline edit re-editable** after the crash fix: `openEdit`→`confirmEdit` round-trips entirely inside the single items Sheet for url/text/file kinds.
- **One modal invariant**: opening the wizard closes the items sheet and clears `editingId`; closing the items sheet clears `editingId`.
- **Note-kind global note**: merged into text (no `notes` field on `NoteMaterial`) so it reaches the BLOG draft.
- **Mixed image-batch notes**: distinct per-photo notes joined; identical global note deduped to one; empty batch → `""`.
- **Submit guards** unchanged: `trayErrors.hasCritical` still blocks the footer (`composer.tsx:1364`); failed-card retention by `Material` reference still works (`composer.tsx:678-685`).

## Out of scope / deferred

- No DB/API/worker changes — existing `notes` plumbing in `submit.ts` (url/note/image) suffices.
- Video-loss durability is a separate spec.
- No change to the audience step (Step 1), `AudienceSheet`, focus-create endpoint, or `applyNote` (`materials.ts:233-245`, used by other entry points).

## Open questions

None.
