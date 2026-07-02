// The chat's wire layer: a DefaultChatTransport aimed at /api/app/chat over
// expo/fetch (streaming fetch on iOS/Android). Auth reuses the better-auth expo
// session cookie the rest of the app sends (expo/fetch bypasses authClient's
// cookie hook, so it's attached explicitly). Used by the /llm screen (via
// useChat) and the dev bench (via streamChatTurn).
import { DefaultChatTransport, readUIMessageStream } from "ai";
import { randomUUID } from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";

import { authBaseURL, sessionCookieHeader } from "@/lib/api";

import type { ChatUIMessage } from "./types";

export function createChatTransport(): DefaultChatTransport<ChatUIMessage> {
  return new DefaultChatTransport<ChatUIMessage>({
    api: `${authBaseURL}/api/app/chat`,
    fetch: expoFetch as unknown as typeof globalThis.fetch,
    headers: () => sessionCookieHeader(),
  });
}

// One-shot turn for the dev bench: send the messages, consume the UI message
// stream, return the final assistant message snapshot.
export async function streamChatTurn(args: {
  messages: ChatUIMessage[];
  signal?: AbortSignal;
}): Promise<ChatUIMessage> {
  const transport = createChatTransport();
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: randomUUID(),
    messageId: undefined,
    messages: args.messages,
    abortSignal: args.signal,
  });
  let final: ChatUIMessage | undefined;
  for await (const snapshot of readUIMessageStream<ChatUIMessage>({
    stream,
  })) {
    final = snapshot;
  }
  if (!final) throw new Error("empty chat stream");
  return final;
}
