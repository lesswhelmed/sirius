// The chat's typed UIMessage: standard AI SDK message plus our one custom data
// part — the posts the server agent opened (rendered as tappable Sources).
// Mirrors ChatSource in apps/web/lib/chat/ui-stream.ts.
import type { UIMessage } from "ai";

export interface SourcePost {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

export type ChatUIMessage = UIMessage<
  unknown,
  { "source-posts": SourcePost[] }
>;
