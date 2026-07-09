"use client";

import { useState, useTransition } from "react";
import type {
  ReflectionItemWire,
  ReflectionResponseWire,
} from "../../../../lib/reflections/wire";

// Interactive half of the Reflect section (see reflection-section.tsx, which
// does the server read). Modeled on comments-section.tsx: local state seeded
// from the server render, success-driven updates from the mutation responses.
//
// Owner: unanswered active prompts carry an inline composer; answered ones show
// the answer with Edit/Delete. Superseded prompts (an earlier generation whose
// answer survived regeneration) are read-only history for everyone. Non-owners
// read the Q&A only; answers with audio play through the canReadPost-gated
// streaming route. Authoring here is text-only — recording is a mobile surface.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// Human, quiet failure copy — the 422 safety refusal must read as "not saved",
// never as an accusation.
function saveErrorMessage(status: number): string {
  if (status === 422) {
    return "This couldn't be saved — try different wording.";
  }
  if (status === 503) {
    return "Saving is unavailable right now — your words are still here, try again in a moment.";
  }
  return `Couldn't save (${status}) — try again.`;
}

export function ReflectionThread({
  postSlug,
  isOwner,
  initialItems,
}: {
  postSlug: string;
  isOwner: boolean;
  initialItems: ReflectionItemWire[];
}) {
  const [items, setItems] = useState<ReflectionItemWire[]>(initialItems);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Prompt ids whose existing answer is being edited inline.
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();

  const setDraft = (promptId: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [promptId]: value }));
  const setError = (promptId: string, message: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (message == null) {
        delete next[promptId];
      } else {
        next[promptId] = message;
      }
      return next;
    });

  const applyItem = (item: ReflectionItemWire) =>
    setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
  const applyResponse = (promptId: string, response: ReflectionResponseWire) =>
    setItems((prev) =>
      prev.map((i) => (i.id === promptId ? { ...i, response } : i)),
    );

  // Save a NEW answer for an unanswered prompt (POST …/reflections).
  const saveNew = (promptId: string) => {
    const body = (drafts[promptId] ?? "").trim();
    if (body.length === 0) return;
    setError(promptId, null);
    startTransition(async () => {
      const res = await fetch(`/api/app/posts/${postSlug}/reflections`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId, body }),
      });
      if (!res.ok) {
        setError(promptId, saveErrorMessage(res.status));
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        item?: ReflectionItemWire | null;
      } | null;
      if (data?.item) {
        applyItem(data.item);
      }
      setDraft(promptId, "");
    });
  };

  // Save an EDIT to an existing answer (PATCH /api/app/reflection-responses/[id]).
  const saveEdit = (promptId: string, responseId: string) => {
    const body = (drafts[promptId] ?? "").trim();
    if (body.length === 0) return;
    setError(promptId, null);
    startTransition(async () => {
      const res = await fetch(`/api/app/reflection-responses/${responseId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setError(promptId, saveErrorMessage(res.status));
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        response?: ReflectionResponseWire;
      } | null;
      if (data?.response) {
        applyResponse(promptId, data.response);
      }
      setEditing((prev) => ({ ...prev, [promptId]: false }));
    });
  };

  const onDelete = (promptId: string, responseId: string) => {
    setError(promptId, null);
    startTransition(async () => {
      const res = await fetch(`/api/app/reflection-responses/${responseId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setItems((prev) =>
          prev
            .map((i) => (i.id === promptId ? { ...i, response: null } : i))
            // A superseded prompt whose only answer was deleted leaves the
            // thread (matches listReflectionForPost).
            .filter((i) => i.status === "active" || i.response !== null),
        );
      }
    });
  };

  const composer = (item: ReflectionItemWire) => {
    const isEdit = item.response != null;
    const draft = drafts[item.id] ?? "";
    const error = errors[item.id];
    return (
      <div className="mt-3 flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(item.id, e.target.value)}
          disabled={isPending}
          rows={3}
          maxLength={20000}
          aria-label={`Answer: ${item.question}`}
          placeholder="In your own words…"
          className="w-full resize-y border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] p-3 font-body text-[16px] leading-[1.6] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--color-accent)]"
        />
        {error ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-accent)]">
            {error}
          </span>
        ) : null}
        <div className="flex items-center justify-end gap-4">
          {isEdit ? (
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, [item.id]: false }));
                setError(item.id, null);
              }}
              disabled={isPending}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              isEdit && item.response
                ? saveEdit(item.id, item.response.id)
                : saveNew(item.id)
            }
            disabled={isPending || draft.trim().length === 0}
            className="h-11 border border-[var(--color-ink)] bg-[var(--color-ink)] px-6 text-[var(--color-paper)] transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:border-[var(--color-accent)] enabled:hover:bg-[var(--color-accent)]"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.32em]">
              {isPending ? "Saving…" : "Save answer →"}
            </span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="mx-auto mt-12 max-w-[680px]">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        Reflect
      </h2>
      <p className="mt-2 font-display italic text-[16px] text-[var(--fg-muted)]">
        Questions to make this yours — answer any, in your own words.
      </p>

      <ul className="mt-6 space-y-8">
        {items.map((item) => {
          const answered = item.response != null;
          const isEditing = editing[item.id] === true;
          const canCompose = isOwner && item.status === "active";
          return (
            <li
              key={item.id}
              className="border-b border-[var(--color-rule)] pb-6 last:border-b-0"
            >
              {item.status === "superseded" ? (
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--fg-faint)]">
                  Earlier question
                </p>
              ) : null}
              <p className="font-display text-[19px] leading-[1.35] text-[var(--fg)]">
                {item.question}
              </p>
              {item.rationale ? (
                <p className="mt-1 font-body text-[13px] leading-[1.5] text-[var(--fg-subtle)]">
                  {item.rationale}
                </p>
              ) : null}

              {answered && item.response && !isEditing ? (
                <div className="mt-3">
                  <p className="whitespace-pre-wrap break-words font-body text-[16px] leading-[1.6] text-[var(--fg)]">
                    {item.response.body}
                  </p>
                  {item.response.hasAudio && item.response.audioUrl ? (
                    // No separate caption track: the written answer above IS
                    // the transcript of the recording.
                    <audio
                      controls
                      preload="none"
                      src={item.response.audioUrl}
                      className="mt-3 w-full"
                    />
                  ) : null}
                  <div className="mt-2 flex items-baseline gap-3 font-mono text-[10px] text-[var(--fg-subtle)]">
                    <span>{dateFmt.format(new Date(item.response.updatedAt))}</span>
                    {isOwner && item.status === "active" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(item.id, item.response?.body ?? "");
                            setEditing((prev) => ({
                              ...prev,
                              [item.id]: true,
                            }));
                          }}
                          disabled={isPending}
                          className="uppercase tracking-[0.16em] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            item.response &&
                            onDelete(item.id, item.response.id)
                          }
                          disabled={isPending}
                          className="uppercase tracking-[0.16em] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {canCompose && (!answered || isEditing) ? composer(item) : null}

              {!answered && !canCompose ? (
                <p className="mt-3 font-display italic text-[15px] text-[var(--fg-faint)]">
                  Not answered yet.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
