// Pure SSE frame parser for the chat stream, split out from chat-stream.ts (which
// imports expo/fetch + @/lib/api → expo-file-system/expo-secure-store → react-native)
// so it can be unit-tested under `bun test` without loading native modules — same
// reasoning as nav-dedupe.ts's split from nav.ts.

export interface ChatSourceDTO {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

export type ChatFrame =
  | { t: "token"; v: string }
  | { t: "sources"; v: ChatSourceDTO[] }
  | { t: "error"; v: string }
  | { t: "done" };

// Pull complete `data: <json>\n\n` frames from a rolling buffer; return the leftover
// partial frame as `rest` so the caller can prepend it to the next chunk.
export function parseSseChunk(buffer: string): {
  frames: ChatFrame[];
  rest: string;
} {
  const frames: ChatFrame[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const line = raw.startsWith("data: ") ? raw.slice(6) : raw;
    if (!line) continue;
    try {
      frames.push(JSON.parse(line) as ChatFrame);
    } catch {
      // ignore a malformed frame rather than killing the stream
    }
  }
  return { frames, rest };
}
