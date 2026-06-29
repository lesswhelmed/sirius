"use client";

// Feed / People / Groups tablist for the Friends hub. Feed (the merged shared-
// posts stream) is the default landing; People (friends + requests) and Groups
// (share-group manager) own their own data/mutations. The active tab is synced to
// the `?tab=` query param so a tab — and the group deep-link from the audience
// badge (?tab=groups&group=<id>) — survives a refresh and is shareable. The Feed
// itself is a server component passed in as the `feed` node.

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { GroupSummary } from "../../../lib/groups/types";
import { AddFriend } from "./add-friend";
import {
  type FriendItem,
  FriendsList,
  type RequestItem,
} from "./friends-list";
import { GroupsManager } from "./groups-manager";

export type FriendsTab = "feed" | "people" | "groups";

const TABS: { key: FriendsTab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "people", label: "People" },
  { key: "groups", label: "Groups" },
];

export function FriendsShell({
  friends,
  requests,
  groups,
  feed,
  initialTab = "feed",
  selectedGroupId,
}: {
  friends: FriendItem[];
  requests: RequestItem[];
  groups: GroupSummary[];
  feed: ReactNode;
  initialTab?: FriendsTab;
  selectedGroupId?: string;
}) {
  const [tab, setTab] = useState<FriendsTab>(initialTab);

  // Sync from the `?tab=` query on back/forward (the server picks the initial
  // tab; this keeps the UI in step when the URL changes without a reload).
  useEffect(() => {
    const fromUrl = () => {
      const value = new URLSearchParams(window.location.search).get("tab");
      if (value === "feed" || value === "people" || value === "groups") {
        setTab(value);
      } else {
        setTab("feed");
      }
    };
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, []);

  const select = (key: FriendsTab) => {
    setTab(key);
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (key === "feed") {
        sp.delete("tab");
      } else {
        sp.set("tab", key);
      }
      // Leaving the Groups tab drops the deep-linked group selection.
      if (key !== "groups") sp.delete("group");
      const qs = sp.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
      );
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

      {tab === "feed" ? (
        <div className="panel-in">{feed}</div>
      ) : tab === "people" ? (
        <div className="panel-in space-y-10">
          <AddFriend />
          <FriendsList initialFriends={friends} initialRequests={requests} />
        </div>
      ) : (
        <div className="panel-in">
          <GroupsManager
            initialGroups={groups}
            selectedGroupId={selectedGroupId}
          />
        </div>
      )}
    </div>
  );
}
