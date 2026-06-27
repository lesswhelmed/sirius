"use client";

// THE shared post-audience control. One component, two modes (discriminated
// union):
//   "compose" — controlled value/onChange, NO network on change. The composer
//               owns the value and ships it at submit time.
//   "edit"    — optimistic persist on change: base tiers via the existing
//               PUT /api/app/posts/[slug]/visibility, group selection via
//               PUT /api/app/posts/[slug]/groups (which also sets visibility=GROUP).
//               Revert + role="alert" on failure (the visibility-control pattern).
//
// Internals: the 3 base chips (VisibilityChips, extracted from visibility-control)
// + a GROUP multi-select row ending in a "+ New group" chip that opens the shared
// CreateGroupDialog. Selecting a group ⇒ visibility="GROUP"; clearing all groups
// ⇒ fall back to the last base tier (default PRIVATE). Invariant: groupIds is
// non-empty IFF visibility==="GROUP".

import { useEffect, useState, useTransition } from "react";

import type {
  AudienceValue,
  GroupMember,
  GroupSummary,
  Visibility,
} from "../../../lib/groups/types";
import { useFriends, useGroups } from "../../../lib/groups/use-groups";
import {
  VisibilityChips,
  visibilityHint,
} from "../posts/[slug]/_components/visibility-control";
import { CreateGroupDialog } from "./create-group-dialog";

type BaseVisibility = Exclude<Visibility, "GROUP">;

export type AudiencePickerProps =
  | {
      mode: "compose";
      value: AudienceValue;
      onChange: (next: AudienceValue) => void;
    }
  | {
      mode: "edit";
      slug: string;
      initialValue: AudienceValue;
      initialGroups?: GroupSummary[];
      friends?: GroupMember[];
      canEdit?: boolean;
    };

export function AudiencePicker(props: AudiencePickerProps) {
  const isEdit = props.mode === "edit";
  const seed = isEdit ? props.initialValue : props.value;

  const groupsApi = useGroups(isEdit ? (props.initialGroups ?? []) : []);
  const friendsApi = useFriends(isEdit ? props.friends : undefined);

  const [editValue, setEditValue] = useState<AudienceValue>(seed);
  const [lastBase, setLastBase] = useState<BaseVisibility>(
    seed.visibility !== "GROUP" ? seed.visibility : "PRIVATE",
  );
  const [error, setError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, start] = useTransition();

  const { reload } = groupsApi;
  // Background-refresh the group list on mount (compose starts empty; edit seeds
  // then reconciles).
  useEffect(() => {
    void reload();
  }, [reload]);

  if (isEdit && props.canEdit === false) {
    return null;
  }

  const value = isEdit ? editValue : props.value;
  const { groups } = groupsApi;
  const disabled = pending;

  // ── persistence / change plumbing ──────────────────────────────────────────
  const commit = (next: AudienceValue, request: () => Promise<Response>) => {
    if (next.visibility !== "GROUP") setLastBase(next.visibility);
    if (!isEdit) {
      props.onChange(next);
      return;
    }
    const previous = editValue;
    setEditValue(next);
    setError(false);
    start(async () => {
      try {
        const res = await request();
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setEditValue(previous);
        setError(true);
      }
    });
  };

  const slug = isEdit ? props.slug : "";
  const putVisibility = (v: BaseVisibility) => () =>
    fetch(`/api/app/posts/${slug}/visibility`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: v }),
    });
  const putGroups = (groupIds: string[]) => () =>
    fetch(`/api/app/posts/${slug}/groups`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupIds }),
    });

  const chooseBase = (v: BaseVisibility) => {
    if (value.visibility === v && value.groupIds.length === 0) return;
    commit({ visibility: v, groupIds: [] }, putVisibility(v));
  };

  const applyGroupIds = (groupIds: string[]) => {
    if (groupIds.length === 0) {
      commit({ visibility: lastBase, groupIds: [] }, putVisibility(lastBase));
    } else {
      commit({ visibility: "GROUP", groupIds }, putGroups(groupIds));
    }
  };

  const toggleGroup = (id: string) => {
    const has = value.groupIds.includes(id);
    const next = has
      ? value.groupIds.filter((g) => g !== id)
      : [...value.groupIds, id];
    applyGroupIds(next);
  };

  const selectGroup = (id: string) => {
    if (value.groupIds.includes(id)) return;
    applyGroupIds([...value.groupIds, id]);
  };

  // ── summary line ────────────────────────────────────────────────────────────
  const selectedGroups = groups.filter((g) => value.groupIds.includes(g.id));
  const peopleCount = selectedGroups.reduce((n, g) => n + g.memberCount, 0);
  const summary =
    value.visibility === "GROUP" && selectedGroups.length > 0
      ? `Shared with ${selectedGroups.length} group${
          selectedGroups.length === 1 ? "" : "s"
        } · ${peopleCount} ${peopleCount === 1 ? "person" : "people"}`
      : visibilityHint(value.visibility);

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        Audience
      </p>

      <VisibilityChips
        value={value.visibility}
        onChange={chooseBase}
        disabled={disabled}
      />

      <div className="space-y-1.5 pt-1">
        <p
          id="audience-groups-label"
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]"
        >
          Groups
        </p>
        <div
          role="group"
          aria-labelledby="audience-groups-label"
          className="flex flex-wrap gap-1.5"
        >
          {groups.map((g) => {
            const selected = value.groupIds.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                role="checkbox"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => toggleGroup(g.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors disabled:opacity-50 ${
                  selected
                    ? "border border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--fg)]"
                    : "border border-[var(--color-rule)] text-[var(--fg-muted)] hover:border-[var(--color-accent)] hover:text-[var(--fg)]"
                }`}
              >
                {selected ? (
                  <span aria-hidden="true" className="text-[var(--color-accent)]">
                    ✓
                  </span>
                ) : null}
                <span className="normal-case tracking-normal font-display text-[13px]">
                  {g.name}
                </span>
                <span className="text-[var(--fg-subtle)]">· {g.memberCount}</span>
              </button>
            );
          })}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1 border border-dashed border-[var(--color-rule-strong)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
          >
            <span aria-hidden="true">+</span> New group
          </button>
        </div>
      </div>

      {summary ? (
        <p className="font-display italic text-[13px] text-[var(--fg-subtle)]">
          {summary}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
        >
          Couldn’t save — try again
        </p>
      ) : null}

      {dialogOpen ? (
        <CreateGroupDialog
          onClose={() => setDialogOpen(false)}
          onSaved={(g) => selectGroup(g.id)}
          createGroup={groupsApi.createGroup}
          updateGroup={groupsApi.updateGroup}
          addMember={groupsApi.addMember}
          removeMember={groupsApi.removeMember}
          friends={friendsApi.friends}
          friendsLoading={friendsApi.loading}
          friendsError={friendsApi.error}
          loadFriends={friendsApi.load}
        />
      ) : null}
    </div>
  );
}
