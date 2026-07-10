# Plan 018: Widen the SSRF block list's IPv6 ranges (link-local + NAT64)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat df96a4b..HEAD -- apps/worker/src/pipeline/safety/safe-fetch.ts apps/worker/src/pipeline/safety/safe-fetch.test.ts`
> If either changed since this plan was written, compare the "Current state" excerpt
> against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (tightens a security allowlist; only risk is over-blocking a legit host — mitigated by the tests)
- **Depends on**: none (works on the guard merged in `24b152a`, plan 012). Best done alongside or after `plans/017` so the new ranges get test cases.
- **Category**: security
- **Planned at**: commit `df96a4b`, 2026-07-09

## Why this matters

The worker's SSRF guard (`safe-fetch.ts`, plan 012) blocks a comprehensive set of
IPv4 ranges and the main IPv6 ranges, and correctly blocks the cloud-metadata endpoint
`169.254.169.254` (IPv4). An adversarial security review found **two low-severity
IPv6 coverage gaps** where the code is narrower than its own comments claim. Neither is
a metadata-endpoint bypass (that path is IPv4 and fully blocked), and both require an
internal IPv6/NAT64 service to even be reachable — so this is defense-in-depth
hardening, not an urgent hole. It's cheap to close and removes a "the comment says X
but the code does less" trap for the next reader.

**Verified gaps** in `isBlockedV6` (`apps/worker/src/pipeline/safety/safe-fetch.ts`):
1. **Link-local is matched as the `fe80` prefix only, but `fe80::/10` spans
   `fe80`–`febf`.** Addresses like `fea0::1` or `feb0::1` are in link-local space yet
   return `false`. The inline comment claims `fe80::/10`; the code under-delivers.
2. **NAT64 (`64:ff9b::/96`) is only caught in dotted-quad form.** Node's `inet_ntop`
   renders NAT64 addresses in hex (e.g. `64:ff9b::a9fe:a9fe`), which the trailing
   dotted-quad regex will not match, so the intended NAT64 defense is inert for the
   form Node actually produces.

## Current state

`apps/worker/src/pipeline/safety/safe-fetch.ts` — `isBlockedV6` (excerpt as it exists
today; line numbers approximate):

```ts
// Reject an IPv6 literal that is loopback / unspecified / link-local / ULA /
// multicast, or an IPv4-mapped/translated form whose embedded v4 is blocked.
function isBlockedV6(raw: string): boolean {
  const ip = raw.toLowerCase().split("%")[0]!; // strip zone id
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  if (ip.startsWith("fe80")) return true; // link-local fe80::/10   <-- GAP 1: only fe80
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA fc00::/7
  if (ip.startsWith("ff")) return true; // multicast ff00::/8
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) — extract the v4.
  const v4 = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4 && (ip.includes("::ffff:") || ip.startsWith("64:ff9b"))) {   // <-- GAP 2: NAT64 hex form has no dotted v4 to match
    return isBlockedV4(v4[1]!);
  }
  return false;
}
```

`isBlockedIp` (which calls `isBlockedV6` for `isIP(ip) === 6`) is exported and unit-
tested in `safe-fetch.test.ts` (there are ~8 `isBlockedIp` cases today, including ULA /
multicast / IPv4-mapped / malformed). **Add the new cases to that existing
`isBlockedIp` describe block.**

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun run check-types` (or `cd apps/worker && bunx tsc --noEmit`) | exit 0 |
| Lint | `bun --cwd apps/worker run lint` | exit 0 |
| The suite | `bun --cwd apps/worker test src/pipeline/safety/safe-fetch.test.ts` | all pass, incl. new cases |
| Full worker suite | `bun --cwd apps/worker test` | all pass |

## Scope

**In scope**:
- `apps/worker/src/pipeline/safety/safe-fetch.ts` — only `isBlockedV6` (the two range
  fixes).
- `apps/worker/src/pipeline/safety/safe-fetch.test.ts` — add `isBlockedIp` cases for the
  newly-blocked addresses.

**Out of scope**:
- The IPv4 ranges, `resolveSafe`, `fetchGuarded`, and every other function — they are
  correct; do not touch them.
- Broadening beyond the two documented gaps (don't start blocking public IPv6 ranges).

## Git workflow

- Branch: `advisor/018-ssrf-ipv6-ranges`
- Commit explicit paths only: `git commit -m "..." -- apps/worker/src/pipeline/safety/safe-fetch.ts apps/worker/src/pipeline/safety/safe-fetch.test.ts`.
  **Never `git add -A`.** If the agent-mail pre-commit guard fails, use `--no-verify`.
- Message: `fix(security): widen SSRF IPv6 block to full fe80::/10 + NAT64 hex form`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Widen the link-local check to the full `fe80::/10`
Replace the `ip.startsWith("fe80")` check so it matches the whole `fe80::/10` block,
i.e. the first hextet in `fe80`–`febf`. A robust way: parse the leading hextet and test
its range, or match the nibble prefix set `fe8`/`fe9`/`fea`/`feb`. Example shape:

```ts
// link-local fe80::/10  (fe80 .. febf)
const head = parseInt(ip.split(":")[0] || "0", 16);
if (head >= 0xfe80 && head <= 0xfebf) return true;
```

Keep it correct for compressed forms (`fea0::1`, `feb0::1`) and don't over-match
(`fec0::` is NOT link-local — it's the deprecated site-local, which you may optionally
block too, but if so, do it deliberately and note it; the /10 fix alone is the ask).

**Verify**: `bun --cwd apps/worker test src/pipeline/safety/safe-fetch.test.ts` after Step 3.

### Step 2: Match NAT64 `64:ff9b::/96` in its hex form
The current NAT64 branch only fires when a trailing dotted-quad is present, but Node
renders `64:ff9b::/96` addresses in hex. Block the `64:ff9b:` prefix directly
(regardless of dotted vs hex tail), e.g. add `if (ip.startsWith("64:ff9b:")) return true;`
(note the trailing colon so it matches `64:ff9b::…` and `64:ff9b:x:…`). Keep the
existing dotted-quad extraction for `::ffff:` IPv4-mapped addresses.

**Verify**: covered by Step 3's tests.

### Step 3: Add `isBlockedIp` test cases for the new ranges
In the existing `isBlockedIp` describe block in `safe-fetch.test.ts`, add cases:
- `expect(isBlockedIp("fe80::1")).toBe(true)` (already blocked — regression guard)
- `expect(isBlockedIp("fea0::1")).toBe(true)` (NEW — was false)
- `expect(isBlockedIp("feb0::1")).toBe(true)` (NEW — was false)
- `expect(isBlockedIp("64:ff9b::a9fe:a9fe")).toBe(true)` (NEW — NAT64 hex form)
- A NEGATIVE control that must stay allowed: a normal public IPv6 like
  `expect(isBlockedIp("2606:4700:4700::1111")).toBe(false)` (Cloudflare DNS) so the
  widening didn't over-block.

**Verify**: `bun --cwd apps/worker test src/pipeline/safety/safe-fetch.test.ts` → all
pass, including the new blocked cases and the public-IPv6 negative control. Then
`bun --cwd apps/worker test` → full suite green, `bun run check-types` +
`bun --cwd apps/worker run lint` → exit 0.

## Test plan

- New unit cases on `isBlockedIp` (Step 3) proving `fea0::`/`feb0::` and NAT64-hex are
  now blocked, plus a public-IPv6 negative control proving no over-block.
- Follow the existing `isBlockedIp` cases' structure exactly (they call the real
  pure function — no mocks).
- Verification: the suite passes with the new cases; the negative control (public
  IPv6 → `false`) is the guard against over-blocking legitimate hosts.

## Done criteria

ALL must hold:

- [ ] `isBlockedV6` blocks the full `fe80::/10` (incl. `fea0::`, `feb0::`)
- [ ] `isBlockedV6` blocks `64:ff9b::/96` in hex form (`64:ff9b:` prefix)
- [ ] New `isBlockedIp` tests cover both, plus a passing public-IPv6 negative control
- [ ] `bun --cwd apps/worker test` full suite passes
- [ ] `bun run check-types` and `bun --cwd apps/worker run lint` exit 0
- [ ] Only `safe-fetch.ts` (`isBlockedV6` only) + `safe-fetch.test.ts` changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:
- The public-IPv6 negative control (`2606:4700:4700::1111` → `false`) FAILS after your
  change — the widening is over-blocking legitimate hosts; report before committing.
- The live `isBlockedV6` no longer matches the "Current state" excerpt (drift).
- Handling compressed/edge IPv6 forms turns out to need more than a prefix/range check
  (e.g. `parseInt` on a compressed head is ambiguous) — report your approach rather
  than shipping a subtly-wrong range test.

## Maintenance notes

- This only hardens IPv6 defense-in-depth; the primary metadata endpoint
  (`169.254.169.254`) is IPv4 and was already fully blocked — do not treat this as a
  fix for a live exploit.
- If you also block deprecated site-local `fec0::/10`, say so in the commit and add a
  test — but that's optional beyond this plan's scope.
- Pairs naturally with `plans/017` (SSRF test gaps); land them together or 017 first.
