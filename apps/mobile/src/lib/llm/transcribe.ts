// On-device speech-to-text via Apple's SpeechAnalyzer (@react-native-ai/apple,
// iOS 26+). Used to turn voice memos into note text so the local LLM can draft
// the post without uploading the audio anywhere. Android and older iOS return
// null/false from everything here, and the caller falls back to today's server
// path (upload the file, Gemini reads it).
import { readAsStringAsync } from "expo-file-system/legacy";
import { Platform } from "react-native";

function deviceLanguage(): string {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.split("-")[0] || "en";
  } catch {
    return "en";
  }
}

// Lazy import: the apple package's TurboModules don't exist on Android, and
// resolving them at app-bundle load would crash there.
async function appleModule() {
  if (Platform.OS !== "ios") {
    return null;
  }
  try {
    return await import("@react-native-ai/apple");
  } catch {
    return null;
  }
}

// Downloads the language assets SpeechAnalyzer needs (no-op if present).
// The docs recommend pre-calling this to avoid first-transcription latency —
// the dev bench uses it; production paths get the automatic on-first-use
// download either way.
export async function prepareTranscription(): Promise<boolean> {
  const mod = await appleModule();
  if (!mod) {
    return false;
  }
  try {
    await mod.AppleTranscription.prepare(deviceLanguage());
    return true;
  } catch (err) {
    console.warn(
      `[llm] transcription prepare failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

export async function canTranscribeOnDevice(): Promise<boolean> {
  const mod = await appleModule();
  if (!mod) {
    return false;
  }
  try {
    return mod.AppleTranscription.isAvailable(deviceLanguage());
  } catch {
    return false;
  }
}

export async function transcribeAudio(uri: string): Promise<string | null> {
  try {
    const mod = await appleModule();
    if (!mod || !mod.AppleTranscription.isAvailable(deviceLanguage())) {
      return null;
    }
    const { experimental_transcribe } = await import("ai");
    const audio = await readAsStringAsync(uri, { encoding: "base64" });
    const result = await experimental_transcribe({
      model: mod.apple.transcriptionModel({ language: deviceLanguage() }),
      audio,
    });
    const text = result.text.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.warn(
      `[llm] on-device transcription failed, falling back to upload: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
