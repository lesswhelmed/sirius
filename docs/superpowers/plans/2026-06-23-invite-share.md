# Invite Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-text invite share on web and mobile with an on-brand experience: a server-rendered invite card that unfurls as a rich link preview, a scannable QR, a public landing page, and polished in-app share UI (web modal + mobile sheet) — including sharing the card as an image file on mobile.

**Architecture:** One server-rendered card image (`/u/<handle>/card`) and one QR endpoint (`/u/<handle>/qr`) in `apps/web` are the single source of truth, consumed three ways: Open Graph metadata (link unfurl), the web invite modal, and the mobile invite sheet. The profile page moves from the session-gated `(app)` group to the public `(public)` group so anonymous link-clickers and crawlers can reach it; it shows identity only (never posts).

**Tech Stack:** Next.js 16 (App Router, Cache Components), `next/og` `ImageResponse`, `qrcode` (pure-JS, web only), Expo / React Native (`expo-image`, `expo-clipboard`, `expo-file-system` v56 new File API, `expo-sharing` — new native dep), Better Auth session.

## Global Constraints

- **No test runner exists** in this repo (CLAUDE.md). The per-task "test cycle" is: `bun run check-types` (zero errors) + `bun run lint` (zero warnings; `--max-warnings 0`) + the manual render checks named in each task. Never claim automated tests pass.
- **Run `bun run db:generate` before any typecheck/build** (generated Prisma client is gitignored).
- **Cache Components:** never add `export const dynamic` or `export const runtime` to any web route/page (Next 16 rejects them under cacheComponents). Routes are dynamic by reading params/headers.
- **Web imports are relative** (no path alias); **mobile uses `@/` alias** (`@/components/sirius`, `@/lib/auth-client`, `@/constants/theme-context`).
- **Brand palette literals** (image runtime can't read CSS vars), mirroring `apps/web/app/(marketing)/product/opengraph-image.tsx`: `PAPER #15110d`, `INK #ece3d3`, `INK_SUBTLE #948775`, `ACCENT #d65f57`, `SERIF "Georgia, 'Times New Roman', serif"`, `MONO "'SF Mono', ui-monospace, Menlo, monospace"`.
- **Constants:** `APP_STORE_URL = "https://apps.apple.com/us/app/sirius-ai/id6775729513"` (`apps/web/app/(marketing)/constants.ts`); `SITE_URL` (`apps/web/lib/site.ts`); `authBaseURL` on mobile (`@/lib/auth-client`).
- **Git/swarm:** this repo runs a multi-agent swarm on `main`. Work on a feature branch; commit **only the explicit paths** each task lists (never `git add -A`). Co-author trailer on commits: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Native rebuild:** Phase 3 adds `expo-sharing`, a native input change. The next `bun run dev` runs a one-time clean prebuild (+ pod install); `bun run verify:native-ai` still passes (on-device-AI bridge untouched). No config-plugin entry is needed for `expo-sharing`.
- Spec: `docs/superpowers/specs/2026-06-23-invite-share-design.md`.

---

## Phase 1 — Shared web backend (card, QR, public landing)

Everything the web modal and mobile sheet consume. After this phase, links unfurl and the landing page works for anon/self/other.

### Task 1: Invite card image route

**Files:**
- Create: `apps/web/app/(public)/u/[handle]/card/route.ts`

**Interfaces:**
- Consumes: `findUserByHandle` from `@repo/db`; `SITE_URL` from `apps/web/lib/site.ts`.
- Produces: `GET /u/<handle>/card` → `image/png`, 1200×630. Consumed by Task 3 metadata, Task 4 (web modal), Task 5 (mobile sheet).

- [ ] **Step 1: Write the route**

```ts
// apps/web/app/(public)/u/[handle]/card/route.ts
import { ImageResponse } from "next/og";
import { findUserByHandle } from "@repo/db";
import { SITE_URL } from "../../../../../lib/site";

const PAPER = "#15110d";
const INK = "#ece3d3";
const INK_SUBTLE = "#948775";
const ACCENT = "#d65f57";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'SF Mono', ui-monospace, Menlo, monospace";
const SIZE = { width: 1200, height: 630 };

function absolute(image: string | null | undefined): string | null {
  if (!image) return null;
  return image.startsWith("http") ? image : `${SITE_URL}${image}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const user = await findUserByHandle(handle);
  const name = user?.name ?? (user?.handle ? `@${user.handle}` : "Sirius");
  const at = user?.handle ? `@${user.handle}` : "";
  const avatar = absolute(user?.image);
  const initial = (user?.name ?? user?.handle ?? "S").trim().charAt(0).toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: "72px 80px",
          backgroundImage: `radial-gradient(ellipse 70% 60% at 10% 0%, rgba(214,95,87,0.12), transparent 60%)`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: MONO,
            fontSize: 22,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: INK_SUBTLE,
          }}
        >
          <span>You&#39;re invited to Sirius</span>
          <span style={{ color: ACCENT }}>iOS · Web</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          {avatar ? (
            <img
              src={avatar}
              width={220}
              height={220}
              style={{ width: 220, height: 220, borderRadius: 110, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: 220,
                height: 220,
                borderRadius: 110,
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(236,227,211,0.06)",
                border: `2px solid ${INK_SUBTLE}`,
                fontFamily: SERIF,
                fontSize: 96,
                color: INK,
              }}
            >
              {initial}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
            <div style={{ display: "flex", fontFamily: SERIF, fontSize: 88, lineHeight: 1, letterSpacing: -2, color: INK }}>
              {name}
            </div>
            {at ? (
              <div style={{ display: "flex", marginTop: 12, fontFamily: MONO, fontSize: 28, color: ACCENT }}>
                {at}
              </div>
            ) : null}
            <div style={{ display: "flex", marginTop: 22, fontFamily: SERIF, fontSize: 34, lineHeight: 1.25, color: INK_SUBTLE }}>
              Add me on Sirius — my personal catalog of everything worth keeping.
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontFamily: MONO,
            fontSize: 22,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: INK_SUBTLE,
          }}
        >
          <span style={{ color: ACCENT, fontSize: 28 }}>⁂</span>
          <span>Capture · Draft · Curate · Publish</span>
        </div>
      </div>
    ),
    SIZE,
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: `bun run db:generate && bun --cwd apps/web run dev` then open `https://sirius.local/u/<your-handle>/card`.
Expected: a 1200×630 PNG matching the mockup (avatar/initial, serif name, oxblood `@handle`, asterism rail). Try a handle with no avatar → initials tile.

- [ ] **Step 3: Typecheck + lint**

Run: `bun run check-types && bun run lint`
Expected: zero errors, zero warnings.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(public)/u/[handle]/card/route.ts
git commit -m "feat(web): invite card image route"
```

---

### Task 2: QR code route

**Files:**
- Modify: `apps/web/package.json` (add `qrcode` + `@types/qrcode`)
- Create: `apps/web/app/(public)/u/[handle]/qr/route.ts`

**Interfaces:**
- Consumes: `SITE_URL` from `apps/web/lib/site.ts`; `qrcode`.
- Produces: `GET /u/<handle>/qr` → `image/svg+xml` encoding `${SITE_URL}/u/<handle>`. Consumed by Task 4 and Task 5.

- [ ] **Step 1: Add the dependency**

Run: `bun add --cwd apps/web qrcode && bun add --cwd apps/web -d @types/qrcode`
Expected: `qrcode` in `dependencies`, `@types/qrcode` in `devDependencies`.

- [ ] **Step 2: Write the route**

```ts
// apps/web/app/(public)/u/[handle]/qr/route.ts
import QRCode from "qrcode";
import { SITE_URL } from "../../../../../lib/site";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const url = `${SITE_URL}/u/${handle}`;
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#15110d", light: "#ffffff" },
  });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=3600",
    },
  });
}
```

- [ ] **Step 3: Verify it renders + scans**

Run: open `https://sirius.local/u/<your-handle>/qr`.
Expected: a QR SVG. Scan with a phone camera → opens `https://<site>/u/<handle>`.

- [ ] **Step 4: Typecheck + lint**

Run: `bun run check-types && bun run lint`
Expected: zero errors/warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json bun.lock apps/web/app/(public)/u/[handle]/qr/route.ts
git commit -m "feat(web): invite QR code route"
```

---

### Task 3: Public invite landing page (move + anon/self/other + metadata)

**Files:**
- Delete: `apps/web/app/(app)/u/[handle]/page.tsx`
- Create: `apps/web/app/(public)/u/[handle]/page.tsx`

**Interfaces:**
- Consumes: `findUserByHandle`, `friendshipState` from `@repo/db`; `getSessionOrNull` from `apps/web/lib/session.ts`; `AddFriendButton` from `apps/web/app/(public)/catalog/[handle]/add-friend-button.tsx`; `APP_STORE_URL` from `apps/web/app/(marketing)/constants.ts`; `SITE_URL` from `apps/web/lib/site.ts`; the card route from Task 1.
- Produces: public `GET /u/<handle>` page + `generateMetadata` wiring `openGraph.images` to `…/card`.

- [ ] **Step 1: Remove the old session-gated page**

Run: `git rm apps/web/app/(app)/u/[handle]/page.tsx`
Expected: file removed. (Its `(app)/u/[handle]/` dir is now empty.)

- [ ] **Step 2: Write the public page + metadata**

```tsx
// apps/web/app/(public)/u/[handle]/page.tsx
import type { Metadata } from "next";
import { findUserByHandle, friendshipState } from "@repo/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionOrNull } from "../../../../lib/session";
import { SITE_URL } from "../../../../lib/site";
import { APP_STORE_URL } from "../../../(marketing)/constants";
import { AddFriendButton } from "../../catalog/[handle]/add-friend-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const user = await findUserByHandle(handle);
  if (!user || !user.handle) return { title: "Sirius" };
  const name = user.name ?? `@${user.handle}`;
  const url = `${SITE_URL}/u/${user.handle}`;
  const card = `${url}/card`;
  const title = `Add ${name} on Sirius`;
  const description =
    user.bio ?? "My personal catalog of everything worth keeping.";
  return {
    title,
    description,
    alternates: { canonical: `/u/${user.handle}` },
    openGraph: {
      type: "profile",
      url,
      title,
      description,
      images: [{ url: card, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description, images: [card] },
  };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const target = await findUserByHandle(handle);
  if (!target || !target.handle) notFound();

  const session = await getSessionOrNull();
  const viewerId = session?.user.id ?? null;
  const isSelf = viewerId === target.id;
  const relState =
    viewerId && !isSelf ? await friendshipState(viewerId, target.id) : null;

  return (
    <section className="mx-auto max-w-[560px]">
      <header className="hairline-b pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          {isSelf ? "Your invite link" : `Add a friend · @${target.handle}`}
        </p>
        <h1 className="mt-1 font-display italic text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[52px]">
          {target.name}
          <span className="text-[var(--color-accent)]">.</span>
        </h1>
        {target.bio ? (
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            {target.bio}
          </p>
        ) : null}
      </header>

      <img
        src={`/u/${target.handle}/card`}
        alt={`Add ${target.name ?? target.handle} on Sirius`}
        width={1200}
        height={630}
        className="mt-8 w-full rounded-lg border border-[var(--color-rule)]"
      />

      <div className="mt-8">
        {isSelf ? (
          <p className="font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
            This is your own invite link. Share it with friends so they can add
            you. Manage your{" "}
            <Link
              href="/friends"
              className="underline decoration-[var(--color-rule-strong)] underline-offset-4 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
            >
              friends
            </Link>
            .
          </p>
        ) : viewerId ? (
          <AddFriendButton
            userId={target.id}
            handle={target.handle}
            initialState={relState!}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <a
              href={APP_STORE_URL}
              className="inline-flex w-fit border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-paper)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]"
            >
              Get Sirius
            </a>
            <Link
              href={`/sign-in?next=${encodeURIComponent(`/u/${target.handle}`)}`}
              className="w-fit font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
            >
              Sign in to add me
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify all three states + unfurl**

Run: with `bun run dev` up:
- Signed in as a **different** user → visit `/u/<target-handle>` → card + AddFriend flow works.
- Signed in as **yourself** → `/u/<own-handle>` → "Your invite link" + card.
- **Logged out** (incognito) → `/u/<handle>` → card + "Get Sirius" + "Sign in to add me"; clicking Sign in returns to `/u/<handle>` after auth.
- Paste `https://<site>/u/<handle>` into an OG inspector (or iMessage) → unfurls into the card.

- [ ] **Step 4: Typecheck + lint**

Run: `bun run check-types && bun run lint`
Expected: zero errors/warnings. (Confirms the moved imports resolve and no stale references to the deleted `(app)/u` page remain.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(public)/u/[handle]/page.tsx apps/web/app/(app)/u
git commit -m "feat(web): public invite landing page with rich OG card"
```

---

## Phase 2 — Web in-app share UI

### Task 4: Web invite modal

**Files:**
- Create: `apps/web/app/(app)/settings/invite-dialog.tsx`
- Modify: `apps/web/app/(app)/settings/page.tsx` (swap `ShareHandle` → `InviteDialog`)
- Delete: `apps/web/app/(app)/settings/share-handle.tsx`

**Interfaces:**
- Consumes: the card route (Task 1), QR route (Task 2), public landing (Task 3).
- Produces: `<InviteDialog handle={string} />` client component.

- [ ] **Step 1: Confirm current usage**

Run: `grep -n "ShareHandle" apps/web/app/(app)/settings/page.tsx`
Expected: the import + JSX usage with the `handle` prop. Note the exact prop wiring to reproduce it.

- [ ] **Step 2: Write the invite dialog**

```tsx
// apps/web/app/(app)/settings/invite-dialog.tsx
"use client";

import { useState } from "react";

export function InviteDialog({ handle }: { handle: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/u/${handle}`
      : `/u/${handle}`;
  const cardSrc = `/u/${handle}/card`;
  const qrSrc = `/u/${handle}/qr`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Add me on Sirius",
          text: "Add me on Sirius",
          url: link,
        });
        return;
      } catch {
        // user canceled or unsupported — fall through to copy
      }
    }
    void copy();
  }

  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        Share invite link
      </button>
      <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
        /u/{handle}
      </span>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Invite a friend"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[640px] border border-[var(--color-rule-emphatic)] bg-[var(--bg)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between hairline-b pb-3">
              <h2 className="font-display italic text-[24px] text-[var(--fg)]">
                Invite a friend
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="font-mono text-[14px] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 grid gap-6 sm:grid-cols-[1fr_180px]">
              <img
                src={cardSrc}
                alt="Your invite card"
                className="w-full self-start rounded-lg border border-[var(--color-rule)]"
              />
              <div className="flex flex-col items-center gap-2">
                <img
                  src={qrSrc}
                  alt="QR code to add me"
                  className="h-[160px] w-[160px] rounded-md bg-white p-2"
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                  Scan to add me
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <input
                readOnly
                value={link}
                className="min-w-[180px] flex-1 border border-[var(--color-rule)] bg-transparent px-3 py-2 font-mono text-[12px] text-[var(--fg-muted)]"
              />
              <button
                type="button"
                onClick={copy}
                className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
              <button
                type="button"
                onClick={share}
                className="border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-paper)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Swap it into the settings page**

In `apps/web/app/(app)/settings/page.tsx`, replace the `ShareHandle` import with `import { InviteDialog } from "./invite-dialog";` and the `<ShareHandle handle={...} />` usage with `<InviteDialog handle={...} />` (same prop). Then remove the old component:

Run: `git rm apps/web/app/(app)/settings/share-handle.tsx`

- [ ] **Step 4: Verify**

Run: with dev up, go to `/settings` → click "Share invite link" → modal shows card + QR + link; "Copy" copies; on a browser supporting `navigator.share` the "Share" button opens the OS share sheet (desktop Chrome falls back to copy); ✕ and backdrop close it.

- [ ] **Step 5: Typecheck + lint**

Run: `bun run check-types && bun run lint`
Expected: zero errors/warnings (no dangling `ShareHandle` references).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(app)/settings/invite-dialog.tsx apps/web/app/(app)/settings/page.tsx apps/web/app/(app)/settings/share-handle.tsx
git commit -m "feat(web): polished invite modal with card + QR"
```

---

## Phase 3 — Mobile invite sheet (adds expo-sharing)

### Task 5: InviteSheet component + expo-sharing dependency

**Files:**
- Modify: `apps/mobile/package.json` (add `expo-sharing`)
- Create: `apps/mobile/src/components/invite-sheet.tsx`

**Interfaces:**
- Consumes: `Sheet`, `PrimaryButton`, `SecondaryButton` from `@/components/sirius`; `useTheme`, `useThemedStyles` from `@/constants/theme-context`; `authBaseURL` from `@/lib/auth-client`; the card/QR routes (Tasks 1–2); `expo-image`, `expo-clipboard`, `expo-file-system`, `expo-sharing`.
- Produces: `<InviteSheet handle={string} visible={boolean} onClose={() => void} />`.

- [ ] **Step 1: Add the dependency**

Run: `bunx --cwd apps/mobile expo install expo-sharing`
Expected: `expo-sharing` added to `apps/mobile/package.json` at the SDK-56-compatible version.

- [ ] **Step 2: Write the InviteSheet**

```tsx
// apps/mobile/src/components/invite-sheet.tsx
import { useState } from "react";
import { Share, View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { authBaseURL } from "@/lib/auth-client";
import { useTheme } from "@/constants/theme-context";
import { Sheet, PrimaryButton, SecondaryButton, Eyebrow } from "@/components/sirius";

export function InviteSheet({
  handle,
  visible,
  onClose,
}: {
  handle: string;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const link = `${authBaseURL}/u/${handle}`;
  const cardUri = `${authBaseURL}/u/${handle}/card`;
  const qrUri = `${authBaseURL}/u/${handle}/qr`;

  async function copyLink() {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareLink() {
    await Share.share({ message: "Add me on Sirius", url: link });
  }

  async function shareCardImage() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        await shareLink();
        return;
      }
      const file = await File.downloadFileAsync(cardUri, Paths.cache);
      await Sharing.shareAsync(file.uri, {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: "Share your Sirius invite",
      });
    } catch {
      await shareLink();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="Invite a friend" onClose={onClose}>
      <View style={styles.gap}>
        <Image
          source={{ uri: cardUri }}
          style={styles.card}
          contentFit="contain"
          accessibilityLabel="Your invite card"
        />
        <View style={[styles.qrTile, { backgroundColor: "#ffffff" }]}>
          <Image source={{ uri: qrUri }} style={styles.qr} contentFit="contain" />
        </View>
        <Eyebrow style={{ textAlign: "center", color: t.color.fgSubtle }}>
          Scan to add me
        </Eyebrow>

        <PrimaryButton label="Share link" symbol="square.and.arrow.up" onPress={shareLink} />
        <SecondaryButton
          label="Share card image"
          symbol="photo"
          busy={busy}
          onPress={shareCardImage}
        />
        <SecondaryButton
          label={copied ? "Copied ✓" : "Copy link"}
          symbol="link"
          onPress={copyLink}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
  card: { width: "100%", aspectRatio: 1200 / 630, borderRadius: 10 },
  qrTile: { alignSelf: "center", borderRadius: 12, padding: 12 },
  qr: { width: 160, height: 160 },
});
```

Note: confirm the theme token name for the subtle foreground against `@/constants/theme-context` (the codebase uses `useThemedStyles(makeStyles)` elsewhere — if `t.color.fgSubtle` differs, use the established token). `symbol` values are SF Symbols already used by `SecondaryButton`/`PrimaryButton`.

- [ ] **Step 3: Typecheck + lint**

Run: `bun run check-types && bun run lint`
Expected: zero errors/warnings. (Resolves `expo-sharing` types, the `File`/`Paths` v56 API, and the theme token name — fix the token if flagged.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json bun.lock apps/mobile/src/components/invite-sheet.tsx
git commit -m "feat(mobile): InviteSheet with card preview, QR, copy + image share"
```

---

### Task 6: Wire InviteSheet into settings

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: `<InviteSheet />` from Task 5.
- Produces: the "Share invite link" button opens the sheet (replaces the raw `Share.share`).

- [ ] **Step 1: Replace the handler with sheet state**

In `apps/mobile/src/app/(tabs)/settings.tsx`:
- Add `import { InviteSheet } from "@/components/invite-sheet";`.
- Add state near the other `useState`s: `const [inviteVisible, setInviteVisible] = useState(false);`.
- Replace the `handleShareInvite` body so it opens the sheet:

```tsx
function handleShareInvite() {
  if (!handle) return;
  setInviteVisible(true);
}
```

- The existing button stays as-is (`<SecondaryButton label="Share invite link" symbol="square.and.arrow.up" onPress={handleShareInvite} />`).
- Render the sheet (guarded by `handle`), e.g. just before the screen's closing wrapper:

```tsx
{handle ? (
  <InviteSheet
    handle={handle}
    visible={inviteVisible}
    onClose={() => setInviteVisible(false)}
  />
) : null}
```

- If `Share` from `react-native` is now unused in this file, remove its import to satisfy lint.

- [ ] **Step 2: Native rebuild + simulator verification**

Run: `bun run dev` (first run does the one-time clean prebuild + pod install for `expo-sharing`; confirm `verify:native-ai` passes).
In the iOS Simulator: Account/Settings tab → tap "Share invite link" → sheet opens with card preview + QR; **Copy link** copies; **Share link** opens the OS sheet with the URL; **Share card image** downloads the card and opens the OS share sheet with the PNG.

- [ ] **Step 3: Typecheck + lint**

Run: `bun run check-types && bun run lint`
Expected: zero errors/warnings (no unused `Share` import).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/(tabs)/settings.tsx
git commit -m "feat(mobile): open InviteSheet from settings share button"
```

---

## Self-review notes (spec coverage)

- Rich link preview → Task 1 (card) + Task 3 (`generateMetadata` og:image/twitter).
- Shareable image card → Task 1 (image) + Task 5 (`Sharing.shareAsync` of downloaded card).
- QR code → Task 2 (route) + Task 4 (web tile) + Task 5 (mobile tile).
- Polished in-app UI → Task 4 (web modal) + Tasks 5–6 (mobile sheet).
- Public landing (anon/self/other, identity-only, App Store + Sign-in CTAs) → Task 3.
- Native-dep / rebuild handling → Phase 3 header + Global Constraints.
- No automated tests asserted anywhere; every task's "test cycle" is typecheck + lint + the named manual checks, per repo reality.
