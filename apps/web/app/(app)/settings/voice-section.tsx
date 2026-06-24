"use client";

import {
  VOICE_GENERATOR_PROMPT,
  VOICE_PROFILE_MAX_CHARS,
} from "@repo/ingest-draft";
import { useState } from "react";

// "Your voice" editor: a freeform style profile (server source of truth) that
// shapes the TONE of generated post prose only. Saves via POST /api/app/me/voice.
// The collapsible "Generate your voice" panel hands the user a prompt to paste
// into their own chatbot, then lets them paste the result straight back in.
type SaveState = "idle" | "saving" | "saved" | "error";

export function VoiceSection({ initialVoice }: { initialVoice: string }) {
  const [value, setValue] = useState(initialVoice);
  const [savedValue, setSavedValue] = useState(initialVoice);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [genOpen, setGenOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasteBack, setPasteBack] = useState("");

  const dirty = value !== savedValue;

  async function onSave() {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/app/me/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceProfile: value }),
      });
      if (!res.ok) {
        throw new Error(`request failed (${res.status})`);
      }
      const data = (await res.json()) as { voiceProfile: string | null };
      const canonical = data.voiceProfile ?? "";
      setValue(canonical);
      setSavedValue(canonical);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(VOICE_GENERATOR_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function onApply() {
    const next = pasteBack.trim().slice(0, VOICE_PROFILE_MAX_CHARS);
    if (!next) return;
    setValue(next);
    setSaveState("idle");
    setPasteBack("");
    setGenOpen(false);
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[60ch] font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
        Shape how your posts are written. This guides tone and word choice only —
        it never changes a post’s type, structure, or tags.
      </p>

      <div className="relative">
        <textarea
          value={value}
          maxLength={VOICE_PROFILE_MAX_CHARS}
          aria-label="Voice profile"
          onChange={(e) => {
            setValue(e.target.value);
            if (saveState !== "idle") setSaveState("idle");
          }}
          placeholder="Describe how you write and talk — your tone, favorite words, humor, what excites you…"
          rows={6}
          className="w-full resize-y border border-[var(--color-rule)] bg-transparent px-4 py-3 font-body text-[15px] leading-[1.7] text-[var(--fg)] placeholder:font-display placeholder:italic placeholder:text-[var(--fg-subtle)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] nums-lining text-[var(--fg-subtle)]">
          {value.length} / {VOICE_PROFILE_MAX_CHARS}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saveState === "saving" || !dirty}
          className="border border-[var(--color-rule-emphatic)] bg-[var(--fg)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--bg)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)] disabled:opacity-50"
        >
          {saveState === "saving" ? "Saving…" : "Save changes"}
        </button>
        {saveState === "error" ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Something went wrong — try again.
          </span>
        ) : dirty ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
            Unsaved changes
          </span>
        ) : saveState === "saved" ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
            ✓ Saved
          </span>
        ) : null}
      </div>

      <div className="border border-[var(--color-rule)] p-4">
        <button
          type="button"
          onClick={() => setGenOpen((o) => !o)}
          className="flex w-full items-baseline justify-between gap-3 text-left"
        >
          <span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)]">
              Generate your voice
            </span>
            <span className="mt-1 block max-w-[60ch] font-body text-[13px] leading-[1.6] text-[var(--fg-muted)]">
              Use your assistant to help articulate your style. Copy the prompt
              below into any AI, then paste the summary back here.
            </span>
          </span>
          <span className="font-mono text-[12px] text-[var(--fg-subtle)]">
            {genOpen ? "−" : "+"}
          </span>
        </button>

        {genOpen ? (
          <div className="mt-4 space-y-4">
            <div className="relative">
              <pre className="overflow-x-auto whitespace-pre-wrap border border-[var(--color-rule)] bg-[var(--bg-subtle,transparent)] px-4 py-3 font-body text-[13px] leading-[1.6] text-[var(--fg-muted)]">
                {VOICE_GENERATOR_PROMPT}
              </pre>
              <button
                type="button"
                onClick={onCopy}
                className="absolute right-2 top-2 border border-[var(--color-rule)] bg-[var(--bg)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--fg-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                Paste the result
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <textarea
                  value={pasteBack}
                  onChange={(e) => setPasteBack(e.target.value)}
                  aria-label="Paste generated voice summary"
                  placeholder="Paste the generated summary here…"
                  rows={4}
                  className="min-w-[260px] flex-1 resize-y border border-[var(--color-rule)] bg-transparent px-4 py-3 font-body text-[14px] leading-[1.6] text-[var(--fg)] placeholder:font-display placeholder:italic placeholder:text-[var(--fg-subtle)] focus:border-[var(--color-accent)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={onApply}
                  disabled={pasteBack.trim().length === 0}
                  className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
                >
                  ↳ Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
