// Pure markdown text transforms for the mobile body editor's formatting toolbar.
// Each function takes the current text + a selection and returns the next text +
// where the selection/caret should land — no React, no side effects, so the
// editor can apply a toolbar tap deterministically and the caret always ends up
// somewhere sensible. The command vocabulary (MarkdownCommand) lives here with
// the logic; the toolbar component imports the type from this module.

export type Selection = { start: number; end: number };
export type EditResult = { text: string; selection: Selection };

export type MarkdownCommand =
  | "bold"
  | "italic"
  | "h1"
  | "h2"
  | "list"
  | "quote"
  | "code"
  | "link";

function clampSelection(text: string, selection: Selection): Selection {
  const len = text.length;
  const start = Math.max(0, Math.min(selection.start, len));
  const end = Math.max(start, Math.min(selection.end, len));
  return { start, end };
}

// Wrap the selection in an inline marker (** for bold, * italic, ` code). With
// nothing selected, insert the empty pair and drop the caret between the markers
// so the user can type straight into the emphasis.
function wrapInline(
  text: string,
  selection: Selection,
  marker: string,
): EditResult {
  const sel = clampSelection(text, selection);
  const before = text.slice(0, sel.start);
  const selected = text.slice(sel.start, sel.end);
  const after = text.slice(sel.end);

  if (selected.length === 0) {
    const next = before + marker + marker + after;
    const caret = sel.start + marker.length;
    return { text: next, selection: { start: caret, end: caret } };
  }

  const next = before + marker + selected + marker + after;
  return {
    text: next,
    selection: {
      start: sel.start + marker.length,
      end: sel.end + marker.length,
    },
  };
}

// Build a markdown link. With a selection, it becomes the link text and the
// "url" placeholder is selected so the user types the destination next. With no
// selection, insert a full skeleton and select the "text" placeholder.
function insertLink(text: string, selection: Selection): EditResult {
  const sel = clampSelection(text, selection);
  const before = text.slice(0, sel.start);
  const selected = text.slice(sel.start, sel.end);
  const after = text.slice(sel.end);

  if (selected.length === 0) {
    const label = "text";
    const next = `${before}[${label}](url)${after}`;
    const start = before.length + 1; // just past "["
    return { text: next, selection: { start, end: start + label.length } };
  }

  const next = `${before}[${selected}](url)${after}`;
  // "url" sits after "[" + selected + "](" — select it for quick replacement.
  const urlStart = before.length + selected.length + 3;
  return { text: next, selection: { start: urlStart, end: urlStart + 3 } };
}

// The half-open [start, end) char range of the line(s) the selection touches.
function lineRange(text: string, selection: Selection): Selection {
  const start = text.lastIndexOf("\n", selection.start - 1) + 1; // 0 if none
  const nextNewline = text.indexOf("\n", selection.end);
  const end = nextNewline === -1 ? text.length : nextNewline;
  return { start, end };
}

const HEADING_RE = /^#{1,6}\s+/;

// Toggle a line-leading prefix ("# ", "## ", "- ", "> ") on every non-blank
// line the selection spans. If all those lines already have the prefix, strip it
// (toggle off); otherwise add it. Heading prefixes replace any existing heading
// marker so switching H1<->H2 doesn't stack "### ".
function toggleLinePrefix(
  text: string,
  selection: Selection,
  prefix: string,
  options: { heading?: boolean } = {},
): EditResult {
  const sel = clampSelection(text, selection);
  const range = lineRange(text, sel);
  const block = text.slice(range.start, range.end);
  const lines = block.split("\n");
  const heading = options.heading ?? false;

  const nonBlank = lines.filter((line) => line.trim().length > 0);
  const allHavePrefix =
    nonBlank.length > 0 && nonBlank.every((line) => line.startsWith(prefix));

  const transformed = lines.map((line) => {
    if (line.trim().length === 0) return line; // leave blank lines untouched
    if (allHavePrefix) return line.slice(prefix.length);
    if (heading) return prefix + line.replace(HEADING_RE, "");
    return prefix + line;
  });

  const newBlock = transformed.join("\n");
  const next = text.slice(0, range.start) + newBlock + text.slice(range.end);

  // Collapsed selection => single line; shift the caret by that line's length
  // delta so typing continues where it was instead of replacing the line.
  if (sel.start === sel.end) {
    const delta = newBlock.length - block.length;
    const caret = Math.max(
      range.start,
      Math.min(sel.start + delta, next.length),
    );
    return { text: next, selection: { start: caret, end: caret } };
  }

  // Range selection => keep the reformatted block highlighted.
  return {
    text: next,
    selection: { start: range.start, end: range.start + newBlock.length },
  };
}

// Map a toolbar command to its transform. Single entry point the editor calls.
export function applyMarkdownCommand(
  command: MarkdownCommand,
  text: string,
  selection: Selection,
): EditResult {
  switch (command) {
    case "bold":
      return wrapInline(text, selection, "**");
    case "italic":
      return wrapInline(text, selection, "*");
    case "code":
      return wrapInline(text, selection, "`");
    case "h1":
      return toggleLinePrefix(text, selection, "# ", { heading: true });
    case "h2":
      return toggleLinePrefix(text, selection, "## ", { heading: true });
    case "list":
      return toggleLinePrefix(text, selection, "- ");
    case "quote":
      return toggleLinePrefix(text, selection, "> ");
    case "link":
      return insertLink(text, selection);
  }
}
