// On-device speech-to-text is iOS-only (Apple's SpeechAnalyzer, iOS 26+, via
// @react-native-ai/apple). This is the DEFAULT (non-iOS) implementation: every
// entry point is a no-op so the caller falls back to the server path (upload the
// audio file, Gemini reads it). The real implementation lives in
// `transcribe.ios.ts` — Metro resolves the platform file automatically, which
// keeps @react-native-ai/apple (and its TurboModules, which don't exist off
// iOS) out of the Android/web bundle entirely. Previously this used
// `await import("@react-native-ai/apple")`; Metro compiles dynamic `import()`
// into an async-split module keyed by a numeric id, and a stale split table
// surfaced as a red-box `Requiring unknown module "NNNN"` the try/catch
// couldn't swallow. Platform files avoid that whole mechanism.

export async function prepareTranscription(): Promise<boolean> {
	return false;
}

export async function canTranscribeOnDevice(): Promise<boolean> {
	return false;
}

export async function transcribeAudio(_uri: string): Promise<string | null> {
	return null;
}
