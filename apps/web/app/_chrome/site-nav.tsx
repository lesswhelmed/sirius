"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  folio: string;
}

// Single source of truth for primary navigation. Signed-in users see the same
// bar everywhere — (app) routes and (public) catalog/listing alike — so the
// chrome never changes shape mid-session. Signed-out visitors get the minimal
// public bar.
export const SIGNED_IN_NAV: readonly NavItem[] = [
  { href: "/catalog", label: "Catalog", folio: "I" },
  { href: "/ingest", label: "Ingest", folio: "II" },
  { href: "/queue", label: "Queue", folio: "III" },
  { href: "/projects", label: "Focus", folio: "IV" },
  { href: "/space", label: "Space", folio: "V" },
  { href: "/friends", label: "Friends", folio: "VI" },
  { href: "/settings", label: "Settings", folio: "VII" },
];

// Empty while the public catalog is hidden (see PUBLIC_CATALOG_ENABLED): there
// is nothing public to point a signed-out visitor at. Add items back here when
// public/shared browsing returns.
export const SIGNED_OUT_NAV: readonly NavItem[] = [];

function NavList({
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
    <nav aria-label="Primary">
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
  return <NavList items={items} pathname={pathname} />;
}

// Prerendered shell variant — no usePathname (dynamic), so no active state.
export function SiteNavFallback({ items }: { items: readonly NavItem[] }) {
  return <NavList items={items} pathname={null} />;
}
