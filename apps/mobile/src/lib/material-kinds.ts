// The composer's capture-kind registry. Each entry is one card in the "What are
// you adding?" action grid. This is the UI-side mirror of the submission
// HANDLERS registry in materials.ts: adding a new kind of material is a single
// append here (+ a matching input case in composer.tsx and a submit handler in
// materials.ts), which is what keeps the composer composable and extensible to
// future kinds (video, audio, documents…) without reworking the screen.
import type { SFSymbol } from "sf-symbols-typescript";

import type { Material } from "@/lib/materials";

export type CaptureKindKey =
	| "link"
	| "repo"
	| "note"
	| "photos"
	| "video"
	| "document"
	| "audio";

export type CaptureKind = {
	key: CaptureKindKey;
	label: string;
	// SF Symbol rendered on iOS; `glyph` is the text fallback (Android/web).
	symbol: SFSymbol;
	glyph: string;
	// How tapping the card collects content:
	//   "form"   → open a sheet with a text field (link, note)
	//   "picker" → launch a native picker immediately (photos)
	//   "repo"   → open the GitHub repo sheet (paste → preview → confirm)
	input: "form" | "picker" | "repo";
	// VoiceOver/TalkBack hint describing what activating the card does.
	hint: string;
};

export const CAPTURE_KINDS: CaptureKind[] = [
	{
		key: "link",
		label: "Link",
		symbol: "link",
		glyph: "↗",
		input: "form",
		hint: "Add one or more web links to the tray",
	},
	{
		key: "repo",
		label: "Repository",
		symbol: "chevron.left.forwardslash.chevron.right",
		glyph: "◆",
		input: "repo",
		hint: "Paste a GitHub repo URL, preview it, and add it to the tray",
	},
	{
		key: "note",
		label: "Note",
		symbol: "square.and.pencil",
		glyph: "✎",
		input: "form",
		hint: "Write a text note and add it to the tray",
	},
	{
		key: "photos",
		label: "Photos",
		symbol: "photo.on.rectangle",
		glyph: "▦",
		input: "picker",
		hint: "Pick photos from your library and add them to the tray",
	},
	{
		key: "video",
		label: "Video",
		symbol: "video",
		glyph: "▶",
		input: "picker",
		hint: "Pick a video from your library and add it to the tray",
	},
	{
		key: "document",
		label: "Document",
		symbol: "doc.text",
		glyph: "📄",
		input: "picker",
		hint: "Pick a PDF or Word document and add it to the tray",
	},
	{
		key: "audio",
		label: "Audio",
		symbol: "waveform",
		glyph: "🎙",
		input: "picker",
		hint: "Record a voice memo or pick an audio file and add it to the tray",
	},
];

// Short mono tag shown on each staged tray row.
const TRAY_TAGS: Record<Material["kind"], string> = {
	url: "URL",
	repo: "REPO",
	note: "NOTE",
	image: "PHOTO",
	video: "VIDEO",
	audio: "AUDIO",
	document: "DOC",
	unsupported: "SKIP",
};

export function trayTag(material: Material): string {
	return TRAY_TAGS[material.kind] ?? material.kind.toUpperCase();
}
