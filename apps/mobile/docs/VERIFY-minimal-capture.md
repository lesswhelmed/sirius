# Verification: Minimal Capture screen

Companion to [`RFC-minimal-capture.md`](./RFC-minimal-capture.md). Branch
`feat/mobile-minimal-capture`, single commit touching only
`apps/mobile/src/app/(tabs)/composer.tsx`.

## Automated quality gates (run, not assumed)

| Gate | Command | Result |
|---|---|---|
| Types | `cd apps/mobile && bun run check-types` (`tsc --noEmit`) | ✅ exit 0, clean |
| Lint | `cd apps/mobile && bun run lint` (`expo lint`) | ✅ exit 0, zero warnings/errors |

There is **no test runner** wired in this repo (per `CLAUDE.md`); these two are the
authoritative gates plus manual on-device verification below.

## Independent coworker review (Agent Mail)

Reviewed by a second swarm agent (**RubyMink**) via Agent Mail thread "Review: minimal
Capture diff — PASS" (msg 366 → CloudyDog). Verdict: **PASS — clean to merge.**

- **Frozen submit path:** the entire pre-`return` logic region (lines **105–689**) diffs
  **IDENTICAL** to `main` — every state hook, `commitOmniText`, `stageAndAddAssets`,
  `appendItems`, `removeItem`, `onOverride`, `openEdit`/`confirmEdit`, all 5 pickers +
  `startRecording`/`stopRecording`/`pickAudioFile`, repo flow, `runSubmit`/`finishSubmit`/
  `forceReprocess`/`submit` (incl. paywall + dedup Alert), `toMaterialPairs`. The diff is
  confined to JSX render + `makeStyles`.
- **No dangling refs** to removed styles (`omniCopy`/`emptyTray`/`headerMain`/`headerToolbar`);
  no orphaned imports (`Eyebrow`, `Switch` still used).
- **By-design note (LOW):** Focus / Audience / on-device toggle now reveal after the first
  item rather than on an empty tray. Breaks nothing — see RFC risks.

### Feature-survival map (cited against the new file)

| Feature | Survives | New-file line |
|---|---|---|
| Omni text commit | ✅ | 729 (`commitOmniText`) |
| Multi-URL paste split | ✅ | 229 (`classifyText`) |
| Photos / Video / Files pickers | ✅ | 737 / 745 / 753 |
| Audio / Repo pickers | ✅ | 762 / 771 |
| Per-card edit / override / remove | ✅ | 818–820 |
| SIGHT badge (first image) | ✅ | 817 |
| Focus chips (populated + empty) | ✅ | 836–883 |
| Audience sheet + `describeAudience` | ✅ | 886–902 |
| On-device toggle (ready + needs-download) | ✅ | 905–924 / 925–939 |
| Usage meter | ✅ | 945–949 |
| Process bar (`onSubmit={submit}`) | ✅ | 952–957 |
| Dedup "Process again" Alert | ✅ | 664–682 |

(Line numbers reflect the branch at review time; treat as approximate anchors.)

## Manual verification matrix (iOS Simulator)

Run interactively so portless holds :443: `! bun run dev`. Open the **Capture** tab.

1. **Rest is minimal** — only `Capture.` title, the input, the 5 attachment cards, the share
   tip + `How it works →`, and a disabled "Add something to begin" bar. No tray / Focus /
   Audience / on-device toggle visible.
2. **iOS keyboard** — type a long multi-line note: the active line stays visible above the
   keyboard, a **Done** button appears and dismisses it, and **Return inserts a newline**
   (does not submit).
3. **Add reveals refine** — tap **Add**: the item card, the "Refine & send" band (Focus
   chips, Audience row, Draft-on-device toggle when the model is ready), and "Process 1 Item"
   appear inline.
   - **Focus default reads "Auto"** (not "None") with the hint *"On Auto, Sirius files this
     under the best focus for you. Tap one to choose it yourself."* Tapping a project chip
     swaps the hint to *"You picked the focus. Tap Auto to let Sirius choose instead."* This
     reflects the worker's auto-assign behavior (`assign-org.ts`); no worker change.
4. **Regression sweep (lose nothing):**
   - Paste several URLs at once → splits into one card each.
   - Attach via each of Photos / Video / Files / Audio / Repo.
   - Edit, change-type (override), and remove a staged card.
   - Change **Focus**; open **Audience** and pick FRIENDS / PUBLIC / GROUP.
   - Toggle **Draft on device** (when a model is downloaded).
   - Press **Process** → item lands in Queue/Catalog.
   - Re-submit the same URL → "Already in your catalog" → **Process again** still creates a
     fresh post (dedup path unchanged).

## Sign-off

- Automated gates: ✅
- Independent review: ✅ PASS (RubyMink)
- Manual matrix: ⏳ to be run by the owner on the iOS Simulator (steps above).
