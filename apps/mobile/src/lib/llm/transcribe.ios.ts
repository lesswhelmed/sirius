// iOS-only on-device speech-to-text via Apple's SpeechAnalyzer
// (@react-native-ai/apple, iOS 26+). Used to turn voice memos into note text so
// the local LLM can draft the post without uploading the audio anywhere. Metro
// resolves this `.ios` file on iOS and the no-op `transcribe.ts` everywhere
// else, so the apple TurboModules (which don't exist off iOS) never enter the
// Android/web bundle. Imports are static on purpose — a dynamic `import()` here
// would make Metro async-split the module and could red-box with
// `Requiring unknown module "NNNN"` when that split table goes stale.
import { apple, AppleTranscription } from "@react-native-ai/apple";
import { experimental_transcribe } from "ai";
import { readAsStringAsync } from "expo-file-system/legacy";

function deviceLanguage(): string {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.split("-")[0] || "en";
  } catch {
    return "en";
  }
}

// Downloads the language assets SpeechAnalyzer needs (no-op if present).
// The docs recommend pre-calling this to avoid first-transcription latency —
// the dev bench uses it; production paths get the automatic on-first-use
// download either way.
export async function prepareTranscription(): Promise<boolean> {
  try {
    await AppleTranscription.prepare(deviceLanguage());
    return true;
  } catch (err) {
    console.warn(
      `[llm] transcription prepare failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

export async function canTranscribeOnDevice(): Promise<boolean> {
  try {
    return AppleTranscription.isAvailable(deviceLanguage());
  } catch {
    return false;
  }
}

export async function transcribeAudio(uri: string): Promise<string | null> {
  try {
    if (!AppleTranscription.isAvailable(deviceLanguage())) {
      return null;
    }
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
