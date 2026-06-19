// Globals the Vercel AI SDK expects but Hermes doesn't ship. Must be imported
// before anything that pulls in `ai` — it is the first import of the root
// layout. Per react-native-ai's Expo guidance only structuredClone and the
// text encoder/decoder streams are needed (Expo's runtime already provides
// ReadableStream and friends).
import {
	TextDecoderStream,
	TextEncoderStream,
} from "@stardazed/streams-text-encoding";
import structuredClone from "@ungap/structured-clone";
import { Platform } from "react-native";

if (Platform.OS !== "web") {
	const g = globalThis as Record<string, unknown>;
	if (typeof g.structuredClone !== "function") {
		g.structuredClone = structuredClone;
	}
	if (typeof g.TextEncoderStream !== "function") {
		g.TextEncoderStream = TextEncoderStream;
	}
	if (typeof g.TextDecoderStream !== "function") {
		g.TextDecoderStream = TextDecoderStream;
	}
}
