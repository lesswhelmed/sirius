// Renders a Post.content body as an ordered block tree so YouTube ingests show
// natively: prose via PostMarkdown, `<YouTubeEmbed>` via YouTubeCard, and nested
// `<details>` via Collapsible. Non-YouTube posts parse to a single markdown block
// and render exactly as the old direct-PostMarkdown path did. Replaces the
// `<PostMarkdown markdown={preparePostMarkdown(...)} />` call sites.

import { type ReactNode, useMemo } from "react";
import { View } from "react-native";

import {
  collapseWhitespace,
  rewriteMediaUrls,
} from "@/lib/post-markdown";
import { type Block, parsePostBlocks } from "@/lib/post-blocks";

import { Collapsible } from "./collapsible";
import { PostMarkdown } from "./post-markdown";
import { YouTubeCard } from "./youtube-card";

type RenderOptions = { hasGallery: boolean };

// Exported and recursive so Collapsible bodies render their own markdown and any
// deeper nested details. Children are passed to Collapsible pre-rendered, so
// Collapsible never imports this module (keeps the dependency graph acyclic).
export function renderBlocks(blocks: Block[], opts: RenderOptions): ReactNode {
  return blocks.map((block, i) => {
    if (block.type === "youtube") {
      return <YouTubeCard key={`yt-${i}`} url={block.url} videoId={block.videoId} />;
    }
    if (block.type === "details") {
      return (
        <Collapsible key={`det-${i}`} summary={block.summary}>
          {renderBlocks(block.children, opts)}
        </Collapsible>
      );
    }
    const md = collapseWhitespace(rewriteMediaUrls(block.text, opts));
    if (!md) return null;
    return <PostMarkdown key={`md-${i}`} markdown={md} />;
  });
}

export function PostBody({
  content,
  hasGallery,
}: {
  content: string;
  hasGallery: boolean;
}) {
  const blocks = useMemo(() => parsePostBlocks(content), [content]);
  return <View>{renderBlocks(blocks, { hasGallery })}</View>;
}
