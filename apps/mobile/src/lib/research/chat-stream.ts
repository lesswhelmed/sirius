// Online chat transport: POST the conversation to the server chat route and stream
// the grounded answer back. Replaces the on-device askMyPosts path — the engine
// stays parked. Uses expo/fetch (streaming ReadableStream on iOS/Android). Auth
// reuses the better-auth expo session cookie the rest of the app sends via
// sessionCookieHeader() (authClient.getCookie() under the hood — same cookie the
// app's other native-fetch paths, e.g. uploadFile()/the SSE nudge channel, use;
// expo/fetch bypasses authClient.$fetch's cookie-attaching hook so it must be
// attached explicitly here).
//
// The pure frame parser lives in sse-parse.ts (re-exported below) so it can be
// unit-tested under `bun test` without this file's native-touching imports
// loading — see that file's header comment.
import { fetch as expoFetch } from "expo/fetch";

import { authBaseURL, sessionCookieHeader } from "@/lib/api";

import { type ChatFrame, type ChatSourceDTO, parseSseChunk } from "./sse-parse";

export type { ChatSourceDTO };
export { parseSseChunk };

export class ChatStreamError extends Error {}

export async function apiChatStream(args: {
  messages: { role: string; content: string }[];
  onDelta: (text: string) => void;
  onSources: (sources: ChatSourceDTO[]) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const res = await expoFetch(`${authBaseURL}/api/app/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...sessionCookieHeader(),
    },
    body: JSON.stringify({ messages: args.messages }),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    throw new ChatStreamError(`chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = parseSseChunk(buffer);
    buffer = rest;
    for (const f of frames as ChatFrame[]) {
      if (f.t === "token") args.onDelta(f.v);
      else if (f.t === "sources") args.onSources(f.v);
      else if (f.t === "error") throw new ChatStreamError(f.v);
      // "done" ends the stream; the loop exits on reader done.
    }
  }
}
