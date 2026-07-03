"use client";

import type React from "react";
import { useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

type ProfileNameEditorProps = {
  initialName: string;
};

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function ProfileNameEditor({
  initialName,
}: ProfileNameEditorProps): React.ReactElement {
  const [value, setValue] = useState(initialName);
  const [savedValue, setSavedValue] = useState(initialName);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const cleaned = normalizeName(value);
  const dirty = cleaned !== savedValue;
  const canSave = dirty && cleaned.length > 0 && saveState !== "saving";

  async function onSave() {
    if (!canSave) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/app/me/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleaned }),
      });
      if (!res.ok) {
        throw new Error(`request failed (${res.status})`);
      }
      const data = (await res.json()) as { name: string };
      setValue(data.name);
      setSavedValue(data.name);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--fg-subtle)">
        Name
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (saveState !== "idle") setSaveState("idle");
          }}
          maxLength={80}
          aria-label="Name"
          placeholder="Your name"
          className="min-w-[220px] flex-1 border border-(--color-rule) bg-transparent px-4 py-3 font-display text-[24px] italic leading-none text-(--fg) placeholder:text-(--fg-subtle) focus:border-(--color-accent) focus:outline-none"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          aria-label="Save name"
          className="grid h-11 w-11 place-items-center border border-rule-emphatic font-mono text-[16px] text-(--fg) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-40"
        >
          {saveState === "saving" ? "…" : "✓"}
        </button>
      </div>
      <NameSaveStatus dirty={dirty} saveState={saveState} />
    </div>
  );
}

function NameSaveStatus({
  dirty,
  saveState,
}: {
  dirty: boolean;
  saveState: SaveState;
}): React.ReactElement {
  if (saveState === "error") {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--color-accent)">
        Couldn’t save. Check your connection and try again.
      </p>
    );
  }

  if (dirty) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--fg-subtle)">
        Unsaved changes
      </p>
    );
  }

  if (saveState === "saved") {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--fg-muted)">
        ✓ Saved
      </p>
    );
  }

  return (
    <p className="font-body text-[13px] leading-[1.6] text-(--fg-muted)">
      This is how your name appears to friends.
    </p>
  );
}
