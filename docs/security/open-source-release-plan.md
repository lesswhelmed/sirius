# Open-source release plan: Sirius → "Lesswhelmed" public repo

> Status: **Phases 0–1 and 2.5 DONE (2026-07-10)** — Spritecook key revoked, reviewer +
> 7 friend.demo passwords rotated on prod, plaintext scrubbed from the review guide, and
> the Lesswhelmed brand rename landed (commit `1bd7874`: 62 files, 136 strings; contracts
> untouched; validated via forced typecheck/lint + 73 mobile tests + leftover sweep).
> Phases 2 (PII scrub) and 3–4 (export to `lesswhelmed/lesswhelmed`) remain planned.
> This document itself references secret locations — it is on the export **exclusion list**
> and must NEVER ship in the public repo.

## Context

Goal: open-source this app as **"Lesswhelmed"** under the `lesswhelmed` GitHub org, with
**"Sirius AI" retained as the name of the in-app chat feature**. A three-agent audit
(working tree, full 518-commit git history, credential/account map) found the repo is two
real secrets away from publishable, plus PII/business-doc cleanup.

Decisions already made by Mina (2026-07-10):

- **Fresh-history public repo** at **`lesswhelmed/lesswhelmed`** — single clean initial
  commit; do NOT rewrite/publish the existing `lesswhelmed/sirius` history.
- **Brand-level rename only** — keep bundle id `dev.copt.sirius`, `siriusapp://` scheme,
  EAS projectId, `sirius.local` dev host, PM2 `sirius-*` names as documented legacy internals.
- **Keep RevenueCat publishable keys** in `eas.json` (they're `EXPO_PUBLIC_` client keys).
- **Scrub all PII/infra details** (emails, server IP, SSH paths).
- **Exclude business docs** from the public tree.
- **License: source-available** (PolyForm Noncommercial 1.0.0; BUSL-1.1 acceptable swap).

## Audit findings (verified 2026-07-10, unremediated)

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | 🔴→✅ | Live App Store reviewer password in plaintext on disk; **shared by the 7 `@friend.demo` seed accounts**. CORRECTION: the file is gitignored (`.gitignore:77`) and was **never committed** — disk-only exposure, zero git history hits. RESOLVED 2026-07-10: all 8 passwords rotated (sessions revoked), plaintext replaced with a `PROD_LOGIN_PASSWORD` pointer. | `docs/launch/app-store-review-guide.md:33` |
| 2 | 🔴 | Spritecook **live** API key `sc_live_f5889f68…ae624` in history — deleted from HEAD but reachable from `main` + ~40 refs | `apps/mobile/.mcp.json` in commits `707d20c`, `5056cfb` (2026-06-02) |
| 3 | 🟡 | Personal emails: `saleebmina@icloud.com` ×14, `saleebmina@copt.dev` ×17 (incl. `.env.example` `SAFETY_ALERT_EMAIL` default) | probe scripts, docs, worker code, `.env.example` |
| 4 | 🟡 | Server IP `172.239.45.200`, SSH key path `~/.ssh/id_copt_dev_v1`, deploy user/paths | `scripts/create-production-env.ts`, `docs/HANDOFF-server-bootstrap.md`, `scripts/deploy-remote.sh`, `ecosystem.config.cjs` |
| 5 | 🟡 | Business docs tracked: sale pitch, review guide, releases, beads history, store assets | `docs/launch/`, `docs/releases/`, `HANDOFF-*.md`, `.beads/`, `app-store-assets/` |
| ✅ | — | Root `.env` never committed (`apps/*/.env` are symlinks to it); `.env.example` placeholder-only; no Gemini/Resend/GitHub/AWS/DB-password leaks anywhere in 518 commits; reviewer seed scripts take passwords via env/arg only; `DEV_LOGIN_PASSWORD`, `INGEST_TOKEN`, MCP API keys never committed | — |

Tooling note: neither `gitleaks` nor `trufflehog` is installed locally; the audit was a
manual `git grep` / `git log -G` sweep. Install gitleaks for the verification gate.

## Phase 0 — Mina-only actions (external services)

1. **Revoke the Spritecook `sc_live_…` key** in the Spritecook dashboard
   (api.spritecook.ai). It has lived in a GitHub-hosted repo — treat as compromised even
   though the public repo will have fresh history. Full value recoverable from
   `git show 707d20c:apps/mobile/.mcp.json` when needed.
2. After Phase 1's reset: **update App Store Connect → App Review Information** with the
   new reviewer password.

## Phase 1 — Reset the reviewer password (existing tooling)

Purpose-built script already exists: `scripts/reset-user-password.ts`
(`bun run auth:reset-password`). It hashes via better-auth `hashPassword()`, updates the
`providerId: "credential"` account row, and **revokes all sessions** by default. Requires
`DATABASE_URL` pointed at prod (values from `.env.production`).

1. `bun run auth:reset-password reviewer@lesswhelmed.com` — omit `--password` to
   auto-generate a strong one (printed once). Save into `.env` as `PROD_LOGIN_PASSWORD`
   (the pattern `docs/releases/1.0.2.md` already prescribes) — never commit it.
2. Reset each of the 7 `@friend.demo` accounts to fresh random passwords — they currently
   share the leaked reviewer password: `ava-rivers`, `noah-fields`, `mira-quinn`,
   `leo-marsh`, `sana-okafor`, `theo-lindqvist`, `iris-nakamura` at `<handle>@friend.demo`.
   Nothing needs their passwords afterward; `scripts/create-reviewer-account.ts` re-sets
   them on any future re-seed.
3. Scrub the plaintext value at `docs/launch/app-store-review-guide.md:33` → replace with
   `(from .env PROD_LOGIN_PASSWORD — never commit)`. Commit with explicit path
   (`git commit -- docs/launch/app-store-review-guide.md`, swarm convention).
4. Mina updates App Store Connect (Phase 0.2).
5. Verify: sign in as the reviewer with the NEW password against prod; confirm the old
   one fails.

## Phase 2 — Sanitize the tree (branch in the private repo)

All edits keep scripts working via env-var fallbacks:

- `.env.example`: `SAFETY_ALERT_EMAIL=saleebmina@copt.dev` → empty with a comment.
- Replace hardcoded `saleebmina@icloud.com` defaults with a `$DEV_LOGIN_EMAIL` env
  requirement (clear error if unset) in: `scripts/probe-embedding-scene.sh`,
  `apps/mobile/scripts/realtime-sync-probe.sh`, `apps/worker/scripts/ingest-vision.ts`,
  `apps/mobile/scripts/pass2-offline-sync.workflow.js`.
- `scripts/create-production-env.ts` + `scripts/deploy-remote.sh`: replace IP
  `172.239.45.200`, SSH key path, deploy user/dir defaults with env vars / placeholders;
  `ecosystem.config.cjs` log paths → relative or env-derived.
- Genericize remaining email mentions in files that survive the export (`workflow.md`,
  `scripts/testing/MOBILE-E2E.md`, technical docs) to `<dev account email>`.
- RevenueCat keys in `eas.json` / `apps/mobile/docs/ANDROID-PARITY.md`: **left as-is**
  (decision: keep — publishable client keys).
- Apple `appleTeamId`/`ascAppId` stay in `eas.json` (required for `eas submit`; standard
  for OSS Expo apps — README notes forks must change them).

Verify: `bun run db:generate && bun run check-types --force && bun run lint --force`
(force-bust turbo cache — remote-cache PASS can be stale).

## Phase 2.5 — Brand rename: Sirius → Lesswhelmed (branch in the private repo)

Brand-level only. **Unchanged legacy internals** (documented in the README): bundle id
`dev.copt.sirius`, deep-link scheme `siriusapp://`, EAS projectId, portless host
`sirius.local`, PM2 process names `sirius-web`/`sirius-worker`/`sirius-mcp`,
package/workspace names.

- `apps/mobile/app.json` → `expo.name: "Lesswhelmed"`. Shipping this to the store needs a
  version bump + new iOS build/submit (closed-train rule) — that's a **follow-up
  release**, not part of the OSS export.
- Sweep user-facing strings: mobile UI copy, web marketing pages (`(marketing)`,
  `/product`), auth email templates (`packages/auth/src/email.ts`), page
  titles/metadata — "Sirius" → "Lesswhelmed" wherever it names the *product*.
- **"Sirius AI" = the chat feature**: brand the mobile `/llm` chat screen and the
  ask-my-posts assistant surfaces as "Sirius AI" (the name survives as the assistant's
  identity, intentionally).
- Surviving technical docs refer to the product as Lesswhelmed, noting `sirius`-named
  internals are historical.
- App Store Connect display-name change + lesswhelmed.com site copy: Mina/manual follow-ups.

## Phase 3 — Build the fresh-history public export

1. **Exclusion list** (removed from the public tree; stay in the private repo):
   - `docs/launch/`, `docs/releases/`, `docs/marketing/`, `docs/qa/`, `docs/superpowers/`
   - all `HANDOFF-*.md` and `docs/HANDOFF-*.md`
   - `docs/security/open-source-release-plan.md` (**this file**)
   - `.beads/` (incl. `.br_recovery` WAL junk), `app-store-assets/`
   - `apps/docs` (vestigial Turborepo stub) — candidate, confirm at execution
2. **Export procedure** (private repo untouched):
   - Fresh `git clone` to a scratch dir → apply the Phase 2 + 2.5 branch → delete
     excluded paths → `git checkout --orphan public-release` → single initial commit.
   - Add `LICENSE`: **PolyForm Noncommercial 1.0.0** (or BUSL-1.1 if a change-date model
     is preferred at execution) + license note in README.
   - Rewrite the stale root `README.md` (still describes the Turborepo starter): what
     **Lesswhelmed** is, the "Sirius AI" chat feature, architecture, setup
     (`.env.example`, `worker:setup`, `db:generate`), the legacy-internals note, license.
   - `gh repo create lesswhelmed/lesswhelmed --public` + push the single commit —
     **only after Mina confirms**; that's the publish moment.
3. Existing `lesswhelmed/sirius` stays **private** with full history (it retains the
   revoked Spritecook key + old password — acceptable once both are dead credentials).

## Phase 4 — Verification gate (before the public push)

1. `brew install gitleaks` → `gitleaks detect --source <export-dir>` over the export's
   full (single-commit) history — must be clean.
2. Targeted greps in the export for known-bad strings: the old reviewer password,
   `sc_live_`, `172.239.45.200`, `saleebmina@`, `id_copt_dev_v1` — zero hits required.
3. Build check in the export clone: `bun install && bun run db:generate && bun run build`
   — proves excluded files weren't imported and the rename broke nothing.
4. Rename sweep: grep the export for remaining user-facing "Sirius" — each hit must be an
   intentional "Sirius AI" chat reference or a documented legacy internal.
5. Reviewer sign-in works with the NEW password against prod; old password fails.
6. Only after all pass and Mina confirms: push to the public repo.

## Follow-ups (post-release)

- Add `gitleaks` as a pre-commit/CI step in the public repo.
- Decide a sync strategy: periodic sanitized re-exports vs. making public the primary.
- Ship the store-facing rebrand: `expo.name` change needs a version bump + new iOS
  build/submit, App Store Connect app-name change, lesswhelmed.com copy.
