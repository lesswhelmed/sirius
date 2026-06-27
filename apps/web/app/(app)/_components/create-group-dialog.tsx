"use client";

// The ONE create / edit group flow. Modal chrome cloned from
// settings/invite-dialog.tsx (fixed inset-0 z-50 backdrop, role=dialog
// aria-modal, Esc + click-outside close). Adds a real focus trap + focus restore
// to the invoking chip. Reused by AudiencePicker (compose + edit) and the Friends
// groups-manager. Passing a `group` (GroupDetail) flips it to edit mode (prefill +
// PATCH name/visibility + add/remove-member diff).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  GroupDetail,
  GroupMember,
  GroupPrivacy,
  GroupSummary,
} from "../../../lib/groups/types";
import { GROUP_PRIVACY_OPTIONS } from "../../../lib/groups/types";
import type { UseGroups } from "../../../lib/groups/use-groups";
import { Avatar, FriendName } from "../friends/_components/friend-identity";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CreateGroupDialog({
  onClose,
  onSaved,
  createGroup,
  updateGroup,
  addMember,
  removeMember,
  friends,
  friendsLoading,
  friendsError,
  loadFriends,
  group,
}: {
  onClose: () => void;
  // Fired with the created/updated summary so callers can auto-select it.
  onSaved?: (group: GroupSummary) => void;
  createGroup: UseGroups["createGroup"];
  updateGroup: UseGroups["updateGroup"];
  addMember: UseGroups["addMember"];
  removeMember: UseGroups["removeMember"];
  friends: GroupMember[] | null;
  friendsLoading: boolean;
  friendsError: boolean;
  loadFriends: () => void;
  group?: GroupDetail;
}) {
  const isEdit = group != null;
  const [name, setName] = useState(group?.name ?? "");
  const [privacy, setPrivacy] = useState<GroupPrivacy>(
    group?.visibility ?? "PRIVATE",
  );
  const originalIds = useMemo(
    () => new Set((group?.members ?? []).map((m) => m.id)),
    [group],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(originalIds));
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<Element | null>(null);

  // Lazy-load friends on open; capture + restore focus to the invoking element.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    loadFriends();
    // Autofocus the name field once mounted.
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      const el = restoreRef.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, [loadFriends]);

  // Esc to close + focus trap (Tab/Shift+Tab cycle within the dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((n) => n.offsetParent !== null);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const list = friends ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.handle ? f.handle.toLowerCase().includes(q) : false),
    );
  }, [friends, query]);

  const hasFriends = (friends?.length ?? 0) > 0;
  const showSearch = (friends?.length ?? 0) > 5;
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && hasFriends && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    const ids = [...selected];

    if (!isEdit) {
      const res = await createGroup({
        name: trimmed,
        visibility: privacy,
        memberIds: ids,
      });
      setSubmitting(false);
      if (!res.ok) {
        setFormError(
          res.error === "duplicate-name"
            ? "You already have a group with that name."
            : "Couldn’t create the group — try again.",
        );
        return;
      }
      onSaved?.(res.group);
      onClose();
      return;
    }

    // Edit: PATCH name/visibility (when changed) BEFORE touching members so a
    // duplicate-name rejection leaves the roster untouched.
    const nameChanged = trimmed !== group.name;
    const privacyChanged = privacy !== group.visibility;
    if (nameChanged || privacyChanged) {
      const res = await updateGroup(group.id, {
        ...(nameChanged ? { name: trimmed } : {}),
        ...(privacyChanged ? { visibility: privacy } : {}),
      });
      if (!res.ok) {
        setSubmitting(false);
        setFormError(
          res.error === "duplicate-name"
            ? "You already have a group with that name."
            : "Couldn’t save the group — try again.",
        );
        return;
      }
    }
    const toAdd = ids.filter((id) => !originalIds.has(id));
    const toRemove = [...originalIds].filter((id) => !selected.has(id));
    const memberResults = await Promise.all([
      ...toAdd.map((id) => addMember(group.id, id)),
      ...toRemove.map((id) => removeMember(group.id, id)),
    ]);
    setSubmitting(false);
    // Always resync the manager's roster to server truth (useGroups already
    // reverted any optimistic count on a failed add/remove).
    onSaved?.({
      id: group.id,
      name: trimmed,
      visibility: privacy,
      memberCount: ids.length,
      createdAt: group.createdAt,
      updatedAt: new Date().toISOString(),
    });
    // A member add can fail server-side (group full, or target no longer a
    // friend → 409). Surface it and keep the dialog open instead of reporting a
    // false success.
    if (memberResults.some((ok) => !ok)) {
      setFormError(
        "Some members couldn’t be updated (they may no longer be a friend, or the group is full).",
      );
      return;
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="button"
      tabIndex={-1}
      aria-label="Close group dialog"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[88vh] w-full max-w-[560px] flex-col border border-[var(--color-rule-emphatic)] bg-[var(--bg)] p-6"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit group" : "New group"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between hairline-b pb-3">
          <h2 className="font-display italic text-[24px] text-[var(--fg)]">
            {isEdit ? "Edit group" : "New group"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-[14px] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
          {/* Name */}
          <div className="space-y-2">
            <label
              htmlFor="group-name"
              className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]"
            >
              Name
            </label>
            <input
              id="group-name"
              ref={nameRef}
              type="text"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Close friends, Family, Book club…"
              className="w-full border-0 border-b border-[var(--color-rule)] bg-transparent pb-2 font-display text-[18px] text-[var(--fg)] placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>

          {/* Privacy */}
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              Who can see this group
            </p>
            <div
              role="radiogroup"
              aria-label="Group privacy"
              className="flex flex-wrap gap-1.5"
            >
              {GROUP_PRIVACY_OPTIONS.map((o) => {
                const sel = o.value === privacy;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    aria-label={`${o.label} — ${o.hint}`}
                    onClick={() => setPrivacy(o.value)}
                    className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                      sel
                        ? "bg-[var(--color-accent)] text-[var(--color-paper)]"
                        : "border border-[var(--color-rule)] text-[var(--fg-muted)] hover:border-[var(--color-accent)] hover:text-[var(--fg)]"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="font-display italic text-[13px] text-[var(--fg-subtle)]">
              {GROUP_PRIVACY_OPTIONS.find((o) => o.value === privacy)?.hint}
            </p>
          </div>

          {/* Members */}
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              Members
              <span className="ml-2 text-[var(--color-accent)]">
                {selected.size} selected
              </span>
            </p>

            {friendsLoading ? (
              <p className="py-2 font-display italic text-[14px] text-[var(--fg-subtle)]">
                Loading friends…
              </p>
            ) : friendsError ? (
              <p
                role="alert"
                className="py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
              >
                Couldn’t load friends — try again.
              </p>
            ) : !hasFriends ? (
              <p className="py-2 font-display italic text-[14px] text-[var(--fg-subtle)]">
                Add friends before you can group them.{" "}
                <Link
                  href="/friends"
                  className="text-[var(--color-accent)] underline underline-offset-4"
                >
                  Find friends →
                </Link>
              </p>
            ) : (
              <>
                {showSearch ? (
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a friend by name or @handle"
                    aria-label="Filter friends"
                    className="w-full border-0 border-b border-[var(--color-rule)] bg-transparent pb-2 font-display text-[15px] text-[var(--fg)] placeholder:text-[var(--fg-faint)] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                ) : null}
                <ul className="max-h-[34vh] space-y-0 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <li className="py-3 font-display italic text-[15px] text-[var(--fg-subtle)]">
                      No friend matches “{query}”.
                    </li>
                  ) : (
                    filtered.map((f) => {
                      const checked = selected.has(f.id);
                      return (
                        <li key={f.id} className="hairline-b">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => toggle(f.id)}
                            className="flex w-full items-center gap-3 py-3 text-left"
                          >
                            <Avatar name={f.name} image={f.image} />
                            <span className="min-w-0 flex-1">
                              <FriendName name={f.name} handle={f.handle} />
                            </span>
                            <span
                              aria-hidden="true"
                              className={`flex size-[18px] shrink-0 items-center justify-center border transition-colors ${
                                checked
                                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                                  : "border-[var(--color-rule-strong)] bg-transparent"
                              }`}
                            >
                              {checked ? (
                                <svg
                                  width="11"
                                  height="9"
                                  viewBox="0 0 11 9"
                                  fill="none"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M1 4.5L4 7.5L10 1"
                                    stroke="var(--color-paper)"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </>
            )}
          </div>

          {formError ? (
            <p
              role="alert"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
            >
              {formError}
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end gap-3 hairline-t pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-paper)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}
