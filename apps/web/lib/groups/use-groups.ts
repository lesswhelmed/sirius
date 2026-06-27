"use client";

// Client state for the owner's share groups + a lazy friends loader for the
// create/edit dialog. Mirrors the optimistic useState + useTransition + revert
// pattern used by friends-list.tsx (run) and visibility-control.tsx, so every
// audience surface (composer, post editor, Friends groups-manager) shares ONE
// source of group state instead of each re-implementing fetch/mutate.

import { useCallback, useRef, useState, useTransition } from "react";

import type {
  GroupMember,
  GroupPrivacy,
  GroupSummary,
} from "./types";

// createGroup / updateGroup surface duplicate-name so the dialog can show an
// inline error instead of a generic toast.
export type CreateGroupResult =
  | { ok: true; group: GroupSummary }
  | { ok: false; error: "duplicate-name" | "unknown" };

export type UpdateGroupResult =
  | { ok: true }
  | { ok: false; error: "duplicate-name" | "unknown" };

export interface UseGroups {
  groups: GroupSummary[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createGroup: (input: {
    name: string;
    visibility: GroupPrivacy;
    memberIds: string[];
  }) => Promise<CreateGroupResult>;
  updateGroup: (
    id: string,
    patch: { name?: string; visibility?: GroupPrivacy },
  ) => Promise<UpdateGroupResult>;
  deleteGroup: (id: string) => void;
  addMember: (groupId: string, userId: string) => Promise<boolean>;
  removeMember: (groupId: string, userId: string) => Promise<boolean>;
}

function sortByName(list: GroupSummary[]): GroupSummary[] {
  return [...list].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function useGroups(initial: GroupSummary[] = []): UseGroups {
  const [groups, setGroups] = useState<GroupSummary[]>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/app/groups", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { groups: GroupSummary[] };
      setGroups(sortByName(data.groups));
      setError(null);
    } catch {
      setError("Couldn’t load groups — try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const createGroup = useCallback<UseGroups["createGroup"]>(async (input) => {
    setError(null);
    try {
      const res = await fetch("/api/app/groups", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          visibility: input.visibility,
          memberIds: input.memberIds,
        }),
      });
      if (res.status === 409) {
        return { ok: false, error: "duplicate-name" };
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { ok: true; id: string };
      const now = new Date().toISOString();
      const group: GroupSummary = {
        id: data.id,
        name: input.name.trim(),
        visibility: input.visibility,
        memberCount: input.memberIds.length,
        createdAt: now,
        updatedAt: now,
      };
      setGroups((cur) => sortByName([...cur, group]));
      return { ok: true, group };
    } catch {
      return { ok: false, error: "unknown" };
    }
  }, []);

  const updateGroup = useCallback<UseGroups["updateGroup"]>(
    async (id, patch) => {
      setError(null);
      const previous = groups;
      // Optimistic name/visibility patch.
      setGroups((cur) =>
        sortByName(
          cur.map((g) =>
            g.id === id
              ? {
                  ...g,
                  ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                  ...(patch.visibility !== undefined
                    ? { visibility: patch.visibility }
                    : {}),
                }
              : g,
          ),
        ),
      );
      try {
        const res = await fetch(`/api/app/groups/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.status === 409) {
          setGroups(previous);
          return { ok: false, error: "duplicate-name" };
        }
        if (!res.ok) throw new Error(String(res.status));
        return { ok: true };
      } catch {
        setGroups(previous);
        return { ok: false, error: "unknown" };
      }
    },
    [groups],
  );

  const deleteGroup = useCallback(
    (id: string) => {
      setError(null);
      const previous = groups;
      setGroups((cur) => cur.filter((g) => g.id !== id));
      start(async () => {
        try {
          const res = await fetch(`/api/app/groups/${id}`, {
            method: "DELETE",
            credentials: "include",
          });
          if (!res.ok) throw new Error(String(res.status));
        } catch {
          setGroups(previous);
          setError("Couldn’t delete the group — try again.");
        }
      });
    },
    [groups],
  );

  const addMember = useCallback<UseGroups["addMember"]>(
    async (groupId, userId) => {
      const previous = groups;
      setGroups((cur) =>
        cur.map((g) =>
          g.id === groupId ? { ...g, memberCount: g.memberCount + 1 } : g,
        ),
      );
      try {
        const res = await fetch(`/api/app/groups/${groupId}/members`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) throw new Error(String(res.status));
        return true;
      } catch {
        setGroups(previous);
        return false;
      }
    },
    [groups],
  );

  const removeMember = useCallback<UseGroups["removeMember"]>(
    async (groupId, userId) => {
      const previous = groups;
      setGroups((cur) =>
        cur.map((g) =>
          g.id === groupId
            ? { ...g, memberCount: Math.max(0, g.memberCount - 1) }
            : g,
        ),
      );
      try {
        const res = await fetch(
          `/api/app/groups/${groupId}/members/${userId}`,
          { method: "DELETE", credentials: "include" },
        );
        if (!res.ok) throw new Error(String(res.status));
        return true;
      } catch {
        setGroups(previous);
        return false;
      }
    },
    [groups],
  );

  return {
    groups,
    loading,
    error,
    reload,
    createGroup,
    updateGroup,
    deleteGroup,
    addMember,
    removeMember,
  };
}

// Lazy friends loader for the create/edit-group dialog: GET /api/app/friends once
// (on first open). Seedable from the server so the post-editor avoids a fetch.
export function useFriends(initial?: GroupMember[]) {
  const [friends, setFriends] = useState<GroupMember[] | null>(
    initial ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadedRef = useRef(initial != null);

  const load = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/app/friends", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        friends: (GroupMember & { friendsSince?: string | null })[];
      };
      setFriends(
        data.friends.map((f) => ({
          id: f.id,
          name: f.name,
          handle: f.handle,
          image: f.image,
        })),
      );
      setError(false);
    } catch {
      loadedRef.current = false;
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  return { friends, loading, error, load };
}
