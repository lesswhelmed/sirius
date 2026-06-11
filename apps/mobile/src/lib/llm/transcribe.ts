// On-device speech-to-text via Apple's SpeechAnalyzer (@react-native-ai/apple,
// iOS 26+). Used to turn voice memos into note text so the local LLM can draft
// the post without uploading the audio anywhere. Android and older iOS return
// null from everything here, and the caller falls back to today's server path
// (upload the file, Gemini reads it).
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

export function canTranscribeOnDevice(): boolean {
  if (Platform.OS !== "ios") {
    return false;
  }
  try {
    // Lazy require: the apple package's TurboModule doesn't exist on Android,
    // and importing it at module scope would crash there.
    const { AppleTranscription } =
      require("@react-native-ai/apple") as typeof import("@react-native-ai/apple");
    return AppleTranscription.isAvailable(deviceLanguage());
  } catch {
    return false;
  }
}

export async function transcribeAudio(uri: string): Promise<string | null> {
  try {
    if (!canTranscribeOnDevice()) {
      return null;
    }
    const { apple } =
      require("@react-native-ai/apple") as typeof import("@react-native-ai/apple");
    const { experimental_transcribe } = await import("ai");
    const audio = await readAsStringAsync(uri, { encoding: "base64" });
    const result = await experimental_transcribe({
      model: apple.transcriptionModel({ language: deviceLanguage() }),
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
