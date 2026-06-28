// Splits a Post.content body into an ordered block tree so the native renderer
// can show YouTube ingests properly. The worker emits two constructs the pure
// markdown renderer (react-native-enriched-markdown) can't handle:
//   - `<YouTubeEmbed url="..." />` prepended to YouTube posts
//     (apps/worker/src/pipeline/gemini-runner.ts)
//   - nested `<details>`/`<summary>` collapsibles appended to YouTube posts
//     (apps/worker/src/pipeline/youtube/analysis.ts renderYouTubeAppendix)
// Everything else stays a single markdown block, so non-YouTube posts are
// unaffected. Pure module (no React) — trivially unit-testable.

export type Block =
  | { type: "markdown"; text: string }
  | { type: "youtube"; url: string; videoId: string }
  | { type: "details"; summary: string; children: Block[] };

const DEFAULT_SUMMARY = "Details";

// Line-leading structural tags (the worker always emits these on their own line).
const OPEN_DETAILS = /^<details(?:\s[^>]*)?>$/;
const SUMMARY = /^<summary>(.*)<\/summary>$/;
// Inline self-closing custom embed; tolerate single/double quotes and `/>`/`>`.
const YOUTUBE_EMBED = /<YouTubeEmbed\s+url=(?:"([^"]*)"|'([^']*)')\s*\/?>/g;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const FALLBACK_ID_RE =
  /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/v\/|\/live\/)([A-Za-z0-9_-]{11})/;

// Pulls the 11-char video id out of any common YouTube URL shape. Dependency-free
// (the mobile app can't import the worker's lib/youtube-url.ts). Returns null for
// anything unparseable so callers can drop a malformed embed instead of crashing.
export function extractYouTubeId(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && ID_RE.test(seg)) return seg;
    }
    if (host.includes("youtube")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] && ["embed", "v", "shorts", "live"].includes(parts[0])) {
        if (parts[1] && ID_RE.test(parts[1])) return parts[1];
      }
      const v = u.searchParams.get("v");
      if (v && ID_RE.test(v)) return v;
    }
  } catch {
    // Malformed URL — fall through to the lenient regex.
  }
  const m = raw.match(FALLBACK_ID_RE);
  return m ? m[1]! : null;
}

// Splits a markdown run on inline <YouTubeEmbed> tags, pushing the surrounding
// prose as markdown blocks and each embed as its own youtube block. Drops
// segments that are empty after trim (collapses the worker's blank-line padding).
function emitMarkdown(text: string, out: Block[]): void {
  YOUTUBE_EMBED.lastIndex = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = YOUTUBE_EMBED.exec(text)) !== null) {
    pushMarkdown(text.slice(lastIndex, m.index), out);
    const url = m[1] ?? m[2] ?? "";
    const videoId = extractYouTubeId(url);
    if (videoId) out.push({ type: "youtube", url, videoId });
    lastIndex = YOUTUBE_EMBED.lastIndex;
  }
  pushMarkdown(text.slice(lastIndex), out);
}

function pushMarkdown(text: string, out: Block[]): void {
  const trimmed = text.trim();
  if (trimmed) out.push({ type: "markdown", text: trimmed });
}

type Frame = { summary: string; children: Block[]; hasContent: boolean };

// Stack-based scan: <details> can nest, so a flat regex won't do. Each open
// pushes a frame; ordinary lines buffer as markdown for the current frame; a
// close flushes the buffer and attaches the frame to its parent (attach-on-close
// preserves ordering). Unclosed frames are auto-closed at EOF.
export function parsePostBlocks(content: string): Block[] {
  const root: Block[] = [];
  const stack: Frame[] = [{ summary: "", children: root, hasContent: false }];
  let buffer: string[] = [];

  const top = () => stack[stack.length - 1]!;

  const flush = () => {
    if (buffer.length === 0) return;
    emitMarkdown(buffer.join("\n"), top().children);
    buffer = [];
  };

  const closeFrame = () => {
    const frame = stack.pop()!;
    top().children.push({
      type: "details",
      summary: frame.summary || DEFAULT_SUMMARY,
      children: frame.children,
    });
  };

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (OPEN_DETAILS.test(trimmed)) {
      flush();
      stack.push({ summary: "", children: [], hasContent: false });
      continue;
    }

    const sm = trimmed.match(SUMMARY);
    if (sm && stack.length > 1 && !top().summary && !top().hasContent) {
      // First summary of an open details frame is its label; later ones are text.
      top().summary = sm[1]!.trim();
      continue;
    }

    if (trimmed === "</details>" && stack.length > 1) {
      flush();
      closeFrame();
      continue;
    }

    // Ordinary content line.
    if (trimmed) top().hasContent = true;
    buffer.push(line);
  }

  flush();
  while (stack.length > 1) closeFrame();
  return root;
}
