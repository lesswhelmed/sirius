"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface PublicNavProps {
  signedIn: boolean;
}

export function PublicNav({ signedIn }: PublicNavProps) {
  const pathname = usePathname();
  const items: Array<{ href: string; label: string; folio: string }> = signedIn
    ? [
        { href: "/ingest", label: "Ingest", folio: "I" },
        { href: "/catalog", label: "Catalog", folio: "II" },
        { href: "/queue", label: "Queue", folio: "III" },
        { href: "/inbox", label: "Inbox", folio: "IV" },
      ]
    : [{ href: "/catalog", label: "Catalog", folio: "I" }];

  return (
    <nav aria-label="Primary">
      <ul className="hairline-t hairline-b flex items-stretch">
        {items.map((item, idx) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
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
