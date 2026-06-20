"use client";

import { useEffect, useState } from "react";

// Sectioned Settings layout: a sticky left side panel (Settings masthead +
// vertical nav with an accent rail on the active item) drives which content
// panel shows. Section content is server-rendered and handed in as `content`
// so data fetching stays in the page; this shell only owns the active-section
// state and the chrome. The active id is mirrored to the URL hash so a section
// is deep-linkable and survives a refresh.
export interface SettingsSection {
  id: string;
  label: string;
  folio: string;
  blurb: string;
  content: React.ReactNode;
}

export function SettingsShell({ sections }: { sections: SettingsSection[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  // Sync from the hash on mount (and on back/forward) without risking a
  // hydration mismatch — the server always renders the first section.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (sections.some((s) => s.id === hash)) {
        setActiveId(hash);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [sections]);

  function select(id: string) {
    setActiveId(id);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  }

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-14">
      <aside className="lg:sticky lg:top-8 lg:h-fit lg:w-60 lg:shrink-0 lg:self-start">
        <div className="hairline-b pb-5 lg:border-b-0 lg:pb-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Section VI
          </p>
          <h1 className="mt-1 font-display italic text-[34px] leading-[0.95] tracking-[-0.01em]">
            Settings<span className="text-[var(--color-accent)]">.</span>
          </h1>
          <p className="mt-2 max-w-[26ch] font-body text-[13px] leading-[1.6] text-[var(--fg-muted)]">
            Manage your editorial presence.
          </p>
        </div>

        <nav aria-label="Settings sections" className="mt-5 flex flex-col">
          {sections.map((section) => {
            const isActive = section.id === active?.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => select(section.id)}
                aria-current={isActive ? "page" : undefined}
                className={`group flex w-full flex-col gap-1 border-l-2 py-3 pl-4 text-left transition-colors ${
                  isActive
                    ? "border-[var(--color-accent)] bg-[var(--color-paper-raised)]/50"
                    : "border-transparent hover:bg-[var(--color-paper-raised)]/30"
                }`}
              >
                <span className="flex items-baseline gap-3">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.22em] transition-colors ${
                      isActive
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--fg-subtle)]"
                    }`}
                  >
                    {section.folio}
                  </span>
                  <span
                    className={`font-display italic text-[19px] leading-tight tracking-tight transition-colors ${
                      isActive
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--fg)]"
                    }`}
                  >
                    {section.label}
                  </span>
                </span>
                <span
                  className={`pl-[calc(0.75rem+1.25em)] font-body text-[12px] leading-snug transition-colors ${
                    isActive
                      ? "text-[var(--fg-muted)]"
                      : "text-[var(--fg-subtle)]"
                  }`}
                >
                  {section.blurb}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {active ? (
          <section key={active.id} className="panel-in max-w-[760px]">
            {active.content}
          </section>
        ) : null}
      </div>
    </div>
  );
}
