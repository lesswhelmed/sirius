"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// "Mine / Friends" scope switch for the catalog. Mine = the owner's own posts
// (any status); Friends = published posts friends shared with you (+ public).
// Switching scope drops filters that don't carry across (page offset, owner-only
// category/tag selections).
export function CatalogScope({ scope }: { scope: "mine" | "friends" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const select = (next: "mine" | "friends") => {
    if (next === scope) return;
    const sp = new URLSearchParams(params.toString());
    if (next === "mine") {
      sp.delete("scope");
    } else {
      sp.set("scope", "friends");
    }
    for (const key of ["page", "category", "tag", "status"]) sp.delete(key);
    start(() => {
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return (
    <div
      role="tablist"
      aria-label="Catalog scope"
      aria-busy={pending}
      className="flex items-baseline gap-5 font-mono text-[10px] uppercase tracking-[0.18em]"
    >
      {(["mine", "friends"] as const).map((value) => {
        const active = scope === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => select(value)}
            className={`relative pb-1 transition-colors ${
              active
                ? "text-[var(--color-accent)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            {value === "mine" ? "Mine" : "Friends"}
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 bottom-0 h-[2px] transition-colors ${
                active ? "bg-[var(--color-accent)]" : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
