"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useId, useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  folio: string;
}

type MobileNavItemStyle = CSSProperties & {
  "--mobile-nav-index": number;
};

// Single source of truth for primary navigation. Signed-in users see the same
// bar everywhere — (app) routes and (public) catalog/listing alike — so the
// chrome never changes shape mid-session. Signed-out visitors get the minimal
// public bar.
export const SIGNED_IN_NAV: readonly NavItem[] = [
  { href: "/catalog", label: "Catalog", folio: "I" },
  { href: "/ingest", label: "Ingest", folio: "II" },
  { href: "/projects", label: "Focus", folio: "IV" },
  { href: "/space", label: "Space", folio: "V" },
  { href: "/friends", label: "Friends", folio: "VI" },
  { href: "/settings", label: "Settings", folio: "VII" },
];

// Empty while the public catalog is hidden (see PUBLIC_CATALOG_ENABLED): there
// is nothing public to point a signed-out visitor at. Add items back here when
// public/shared browsing returns.
export const SIGNED_OUT_NAV: readonly NavItem[] = [];

function DesktopNavList({
  items,
  pathname,
}: {
  items: readonly NavItem[];
  pathname: string | null;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Primary" className="hidden lg:block">
      <ul className="hairline-t hairline-b flex items-stretch">
        {items.map((item, idx) => {
          const active =
            pathname != null &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`));
          return (
            <li
              key={item.href}
              className={`flex-1 ${idx > 0 ? "border-l border-[var(--color-rule)]" : ""}`}
            >
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-baseline justify-center gap-2.5 px-3 py-3 transition-colors sm:justify-between sm:px-4 ${
                  active
                    ? "bg-[var(--color-paper-raised)]/60"
                    : "hover:bg-[var(--color-paper-raised)]/40"
                }`}
              >
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.22em] transition-colors ${
                    active
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--fg-subtle)] group-hover:text-[var(--fg-muted)]"
                  }`}
                >
                  {item.folio}
                </span>
                <span
                  className={`font-display italic text-[20px] leading-none tracking-tight transition-colors sm:text-[22px] ${
                    active ? "text-[var(--color-accent)]" : "text-[var(--fg)]"
                  }`}
                >
                  {item.label}
                </span>
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-px h-[2px] bg-[var(--color-accent)]"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SiteNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      <DesktopNavList items={items} pathname={pathname} />
      <MobileBubbleNav items={items} pathname={pathname} />
    </>
  );
}

// Prerendered shell variant — no usePathname (dynamic), so no active state.
export function SiteNavFallback({ items }: { items: readonly NavItem[] }) {
  return (
    <>
      <DesktopNavList items={items} pathname={null} />
      <MobileBubbleNav items={items} pathname={null} />
    </>
  );
}

function MobileBubbleNav({
  items,
  pathname,
}: {
  items: readonly NavItem[];
  pathname: string | null;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`mobile-bubble-nav lg:hidden ${open ? "is-open" : ""}`}
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close navigation" : "Open navigation"}
        className="mobile-bubble-nav__button"
        onClick={() => setOpen((next) => !next)}
      >
        <span aria-hidden="true" className="mobile-bubble-nav__button-folio">
          Nav
        </span>
        <span aria-hidden="true" className="mobile-bubble-nav__button-mark">
          <span />
          <span />
        </span>
      </button>

      <button
        type="button"
        aria-label="Close navigation"
        tabIndex={open ? 0 : -1}
        className="mobile-bubble-nav__backfill"
        onClick={() => setOpen(false)}
      />

      <nav
        id={panelId}
        aria-label="Primary"
        aria-hidden={!open}
        className="mobile-bubble-nav__sheet"
      >
        <div className="mobile-bubble-nav__kicker">
          <span>Primary</span>
          <span aria-hidden="true">Dispatch</span>
        </div>
        <ul className="mobile-bubble-nav__list">
          {items.map((item, idx) => {
            const active =
              pathname != null &&
              (pathname === item.href || pathname.startsWith(`${item.href}/`));
            return (
              <li
                key={item.href}
                className="mobile-bubble-nav__item"
                style={{ "--mobile-nav-index": idx } as MobileNavItemStyle}
              >
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  tabIndex={open ? undefined : -1}
                  className="mobile-bubble-nav__link"
                  onClick={() => setOpen(false)}
                >
                  <span className="mobile-bubble-nav__folio">
                    {item.folio}
                  </span>
                  <span className="mobile-bubble-nav__label">
                    {item.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`mobile-bubble-nav__rule ${
                      active ? "is-active" : ""
                    }`}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
