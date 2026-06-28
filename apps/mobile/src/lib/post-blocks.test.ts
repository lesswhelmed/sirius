// Run with: bun test src/lib/post-blocks.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { extractYouTubeId, parsePostBlocks } from "./post-blocks";

describe("extractYouTubeId", () => {
  test("watch URL", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });
  test("watch URL with &t= timestamp", () => {
    expect(
      extractYouTubeId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=135s"),
    ).toBe("dQw4w9WgXcQ");
  });
  test("youtu.be short URL", () => {
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });
  test("shorts / embed / live paths", () => {
    expect(extractYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });
  test("malformed returns null", () => {
    expect(extractYouTubeId("https://example.com/not-a-video")).toBeNull();
    expect(extractYouTubeId("")).toBeNull();
  });
});

describe("parsePostBlocks", () => {
  test("plain markdown → single block (regression-identical)", () => {
    const body = "# Title\n\nSome **prose** with a [link](/x).";
    expect(parsePostBlocks(body)).toEqual([{ type: "markdown", text: body }]);
  });

  test("top YouTube embed + prose", () => {
    const body =
      '<YouTubeEmbed url="https://youtube.com/watch?v=dQw4w9WgXcQ" />\n\nMy take on the video.';
    const blocks = parsePostBlocks(body);
    expect(blocks[0]).toEqual({
      type: "youtube",
      url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
    });
    expect(blocks[1]).toEqual({
      type: "markdown",
      text: "My take on the video.",
    });
  });

  test("single-quoted embed", () => {
    const blocks = parsePostBlocks(
      "<YouTubeEmbed url='https://youtu.be/dQw4w9WgXcQ' />",
    );
    expect(blocks).toEqual([
      {
        type: "youtube",
        url: "https://youtu.be/dQw4w9WgXcQ",
        videoId: "dQw4w9WgXcQ",
      },
    ]);
  });

  test("malformed embed url is dropped", () => {
    expect(parsePostBlocks('<YouTubeEmbed url="not a url" />')).toEqual([]);
  });

  test("nested details depth-2", () => {
    const body = [
      "<details>",
      "<summary>Full analysis</summary>",
      "",
      "### Overview",
      "Body text.",
      "",
      "<details>",
      "<summary>Raw evidence</summary>",
      "",
      "raw text",
      "",
      "</details>",
      "",
      "</details>",
    ].join("\n");
    const blocks = parsePostBlocks(body);
    expect(blocks).toHaveLength(1);
    const outer = blocks[0];
    expect(outer?.type).toBe("details");
    if (outer?.type !== "details") throw new Error("expected details");
    expect(outer.summary).toBe("Full analysis");
    expect(outer.children[0]).toEqual({
      type: "markdown",
      text: "### Overview\nBody text.",
    });
    const inner = outer.children[1];
    expect(inner).toEqual({
      type: "details",
      summary: "Raw evidence",
      children: [{ type: "markdown", text: "raw text" }],
    });
  });

  test("unclosed details auto-closes at EOF", () => {
    const body = "<details>\n<summary>Open</summary>\n\ncontent";
    const blocks = parsePostBlocks(body);
    expect(blocks).toEqual([
      {
        type: "details",
        summary: "Open",
        children: [{ type: "markdown", text: "content" }],
      },
    ]);
  });

  test("summary-less details falls back to default label", () => {
    const blocks = parsePostBlocks("<details>\n\nhello\n\n</details>");
    expect(blocks).toEqual([
      {
        type: "details",
        summary: "Details",
        children: [{ type: "markdown", text: "hello" }],
      },
    ]);
  });
});
