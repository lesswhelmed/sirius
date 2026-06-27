"use client";

// The Friends → Groups panel: list the owner's share groups (member count +
// privacy tag) with optimistic Edit / Delete, and a "+ New group" that reuses the
// shared CreateGroupDialog (same flow as the composer + post editor). Group state
// lives in the shared useGroups hook.

import { useState } from "react";

import type { GroupDetail, GroupSummary } from "../../../lib/groups/types";
import { useFriends, useGroups } from "../../../lib/groups/use-groups";
import { CreateGroupDialog } from "../_components/create-group-dialog";

const PRIVACY_LABEL: Record<GroupSummary["visibility"], string> = {
  PRIVATE: "Private",
  NAMED: "Named",
};

export function GroupsManager({
  initialGroups,
}: {
  initialGroups: GroupSummary[];
}) {
  const groupsApi = useGroups(initialGroups);
  const friendsApi = useFriends();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<GroupDetail | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);

  const { groups, error, deleteGroup, reload } = groupsApi;

  const openCreate = () => {
    setEditGroup(undefined);
    setLoadError(false);
    setDialogOpen(true);
  };

  const openEdit = async (id: string) => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/app/groups/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { group: GroupDetail };
      setEditGroup(data.group);
      setDialogOpen(true);
    } catch {
      setLoadError(true);
    }
  };

  const confirmDelete = (g: GroupSummary) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete the group “${g.name}”? This can’t be undone.`)
    ) {
      return;
    }
    deleteGroup(g.id);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between gap-4 hairline-b pb-4">
        <h2 className="font-display italic text-[28px] leading-none tracking-[-0.01em]">
          Groups
          <span className="text-[var(--color-accent)]">.</span>
        </h2>
        <button
          type="button"
          onClick={openCreate}
          className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          + New group
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="border-l-2 border-[var(--color-accent)] pl-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
        >
          {error}
        </p>
      ) : null}
      {loadError ? (
        <p
          role="alert"
          className="border-l-2 border-[var(--color-accent)] pl-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
        >
          Couldn’t open that group — try again.
        </p>
      ) : null}

      {groups.length === 0 ? (
        <div className="space-y-4 py-2">
          <p className="font-display italic text-[16px] text-[var(--fg-muted)]">
            No groups yet. Gather a few friends into a named audience to share
            posts with just them.
          </p>
        </div>
      ) : (
        <ul className="space-y-0">
          {groups.map((g) => (
            <li
              key={g.id}
              className="hairline-b flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4"
            >
              <span className="min-w-0">
                <span className="block truncate font-display text-[19px] text-[var(--fg)]">
                  {g.name}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                  <span className="text-[var(--color-accent)]">
                    {g.memberCount}
                  </span>{" "}
                  {g.memberCount === 1 ? "member" : "members"} ·{" "}
                  {PRIVACY_LABEL[g.visibility]}
                </span>
              </span>
              <span className="flex items-baseline gap-4">
                <button
                  type="button"
                  onClick={() => openEdit(g.id)}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => confirmDelete(g)}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen ? (
        <CreateGroupDialog
          onClose={() => setDialogOpen(false)}
          onSaved={() => void reload()}
          createGroup={groupsApi.createGroup}
          updateGroup={groupsApi.updateGroup}
          addMember={groupsApi.addMember}
          removeMember={groupsApi.removeMember}
          friends={friendsApi.friends}
          friendsLoading={friendsApi.loading}
          friendsError={friendsApi.error}
          loadFriends={friendsApi.load}
          group={editGroup}
        />
      ) : null}
    </div>
  );
}
