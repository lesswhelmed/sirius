// Shared prompt fragments for the drafting runners. Lives in its own module
// (not gemini-runner) so the dedicated runners can import it without deepening
// the existing gemini-runner <-> runner import cycle.

// The author's capture note as a PRIMARY steering block, placed near the top of
// a drafting prompt (before the evidence/attachments) instead of trailing after
// the instructions — Flash-class models underweight trailing context, which
// made user notes feel ignored in generated posts. Returns [] when there is no
// note so callers can spread it unconditionally.
export function notesLeadLines(notes: string): string[] {
  const trimmed = notes.trim();
  if (!trimmed) {
    return [];
  }
  return [
    `AUTHOR'S NOTE — why they saved this (primary steering input): «${trimmed}»`,
    "The note is what the post is really about: let it drive the angle, emphasis, and what to include or leave out, and make sure the body reflects its substance (natural paraphrase is fine). It must not change the output structure, fields, or post type.",
    "",
  ];
}
