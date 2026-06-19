// Auto-generates an editorial cover image for posts that resolve to no imageUrl
// (notes → BLOG, plain-URL → FINDING). Without this, those posts fall back to a
// flat type-label placeholder on the catalog grid; with it, every post shows
// something compelling.
//
// Two steps:
//   1. Art-direction brief — a cheap text call (gemini-2.5-flash via the same
//      @ai-sdk/google path as gemini-runner.ts) distills the post's actual
//      subject into a vivid, concrete visual scene. This is what makes each
//      cover bespoke to its material rather than generic.
//   2. Render — Gemini's Nano Banana Pro (gemini-3-pro-image-preview) renders
//      the brief at a pinned aspect ratio / size (only the Pro model honors
//      imageConfig). A fixed house-style suffix on both the brief instructions
//      and the render prompt keeps the whole catalog visually cohesive.
//
// Strictly non-fatal: any failure (no API key, model error, no image part)
// returns null and the caller leaves the post imageless — exactly like the
// existing cover-download fallback in post-writer.ts.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { GoogleGenAI } from "@google/genai";
import { generateText } from "ai";
import { getImageGenConfig, resolveApiKey } from "../lib/ai-config";
import { ensureDir, resolveSocialDir } from "../lib/media-paths";

export type CoverImageInput = {
	slug: string;
	title: string;
	excerpt: string | null;
	content: string;
	type: string;
	tags: string[];
};

// Shared house style — appended to the render prompt and described to the brief
// model so covers read as one collection regardless of subject. No text/words:
// rendered letterforms in AI images are unreliable and look broken at card size.
const HOUSE_STYLE =
	"Editorial fine-art cover in a cohesive, restrained aesthetic: muted sophisticated palette, soft cinematic light, tasteful composition with generous negative space, subtle film grain. A single clear focal subject. No text, words, letters, captions, logos, watermarks, borders, or UI of any kind.";

// First N chars of the body are plenty to anchor the scene; the brief model
// doesn't need the whole post and longer input just costs tokens.
const BODY_CHARS_FOR_BRIEF = 600;

// The image model picks the output format (it currently returns JPEG even for a
// Pro render), so the served filename's extension must match the actual bytes —
// serve-media.ts labels the HTTP Content-Type purely from the extension.
function extForMimeType(mimeType: string | undefined): string {
	switch (mimeType) {
		case "image/jpeg":
		case "image/jpg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/png":
			return "png";
		default:
			return "png";
	}
}

function buildBriefPrompt(input: CoverImageInput): string {
	const tags = input.tags.length > 0 ? input.tags.join(", ") : "none";
	const body = input.content
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, BODY_CHARS_FOR_BRIEF);
	return [
		"You are an art director writing a one-paragraph brief for the COVER IMAGE of a personal-blog post.",
		"Describe a single striking, concrete visual scene that captures the essence of this post — real objects, setting, light, and mood, not abstractions or symbols of words.",
		"Keep it under 70 words. Output ONLY the scene description, no preamble, no quotes, no title.",
		"",
		`Post type: ${input.type}`,
		`Title: ${input.title}`,
		input.excerpt ? `Excerpt: ${input.excerpt}` : "",
		`Tags: ${tags}`,
		`Body (excerpt): ${body}`,
	]
		.filter(Boolean)
		.join("\n");
}

// Generates the art-direction brief. Falls back to a title-derived brief if the
// text call fails, so a brief-stage hiccup still yields a usable render prompt.
async function buildBrief(
	input: CoverImageInput,
	apiKey: string,
	briefModel: string,
): Promise<string> {
	try {
		const google = createGoogleGenerativeAI({ apiKey });
		const { text } = await generateText({
			model: google(briefModel),
			temperature: 0.9,
			system: `You write concise, vivid visual briefs. House style to honor: ${HOUSE_STYLE}`,
			prompt: buildBriefPrompt(input),
		});
		const brief = text.trim();
		if (brief) {
			return brief;
		}
	} catch (err) {
		console.warn(
			`[image-gen] brief failed for ${input.slug}, using title fallback:`,
			err instanceof Error ? err.message : String(err),
		);
	}
	// Fallback brief: still concrete enough for the image model to work with.
	return `A cover image evoking "${input.title}".`;
}

// Renders a cover and writes it to public/social/<slug>.png. Returns the served
// path (/social/<slug>.png) on success, or null on any failure.
export async function generateCoverImage(
	input: CoverImageInput,
): Promise<string | null> {
	const config = getImageGenConfig();
	if (!config.enabled) {
		return null;
	}
	const apiKey = resolveApiKey();
	if (!apiKey) {
		console.warn(
			`[image-gen] no GEMINI_API_KEY; skipping cover for ${input.slug}`,
		);
		return null;
	}

	try {
		const brief = await buildBrief(input, apiKey, config.briefModel);
		const prompt = `${brief}\n\n${HOUSE_STYLE}`;

		const ai = new GoogleGenAI({ apiKey });
		const res = await ai.models.generateContent({
			model: config.model,
			contents: prompt,
			config: {
				imageConfig: {
					aspectRatio: config.aspectRatio,
					imageSize: config.imageSize,
				},
			},
		});

		const parts = res.candidates?.[0]?.content?.parts ?? [];
		const imagePart = parts.find((p) => p.inlineData?.data);
		const data = imagePart?.inlineData?.data;
		if (!data) {
			console.warn(
				`[image-gen] model returned no image for ${input.slug}; keeping placeholder`,
			);
			return null;
		}

		const dir = resolveSocialDir();
		ensureDir(dir);
		const ext = extForMimeType(imagePart?.inlineData?.mimeType);
		const filename = `${input.slug}.${ext}`;
		writeFileSync(join(dir, filename), Buffer.from(data, "base64"));
		return `/social/${filename}`;
	} catch (err) {
		console.warn(
			`[image-gen] cover generation failed for ${input.slug}:`,
			err instanceof Error ? err.message : String(err),
		);
		return null;
	}
}
