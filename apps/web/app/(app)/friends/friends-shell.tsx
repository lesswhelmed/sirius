"use client";

// People / Groups tablist for the Friends section. Hash-synced like SettingsShell
// (#people / #groups) so a tab is deep-linkable and survives a refresh. Owns only
// the active-tab state; the People panel (friends + requests) and the Groups panel
// (share-group manager) own their own data/mutations.

import { useEffect, useState } from "react";

import type { GroupSummary } from "../../../lib/groups/types";
import { AddFriend } from "./add-friend";
import {
  type FriendItem,
  FriendsList,
  type RequestItem,
} from "./friends-list";
import { GroupsManager } from "./groups-manager";

type TabKey = "people" | "groups";

const TABS: { key: TabKey; label: string }[] = [
  { key: "people", label: "People" },
  { key: "groups", label: "Groups" },
];

export function FriendsShell({
  friends,
  requests,
  groups,
}: {
  friends: FriendItem[];
  requests: RequestItem[];
  groups: GroupSummary[];
}) {
  const [tab, setTab] = useState<TabKey>("people");

  // Sync from the hash on mount + on back/forward (server always renders People).
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === "people" || hash === "groups") setTab(hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const select = (key: TabKey) => {
    setTab(key);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${key}`);
    }
  };

  return (
    <div className="space-y-8">
      <div
        role="tablist"
        aria-label="Friends sections"
        className="flex items-baseline gap-6 hairline-b pb-3 font-mono text-[11px] uppercase tracking-[0.2em]"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => select(t.key)}
              className={`relative pb-1 transition-colors ${
                active
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
              }`}
            >
              {t.label}
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 -bottom-[13px] h-px transition-colors ${
                  active ? "bg-[var(--color-accent)]" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      {tab === "people" ? (
        <div className="panel-in space-y-10">
          <AddFriend />
          <FriendsList initialFriends={friends} initialRequests={requests} />
        </div>
      ) : (
        <div className="panel-in">
          <GroupsManager initialGroups={groups} />
        </div>
      )}
    </div>
  );
}
