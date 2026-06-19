// On-device AI preferences, persisted as a small JSON file in the app's
// document directory (same expo-file-system/legacy API the upload path uses).
// Deliberately not SecureStore — nothing here is a secret — and not a server
// setting: whether THIS device drafts locally depends on whether THIS device
// downloaded a model.
import {
  documentDirectory,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

import { DEFAULT_TEXT_MODEL_ID } from "./models";

export type LlmSettings = {
  // Master switch for drafting posts on device before submitting.
  onDeviceCuration: boolean;
  // Which registry model chat + curation use.
  modelId: string;
  // Cached copy of the user's server-side author voice, so on-device drafting
  // can apply it offline. Synced from /api/app/me/voice; null when unset.
  voiceProfile: string | null;
};

const DEFAULTS: LlmSettings = {
  onDeviceCuration: false,
  modelId: DEFAULT_TEXT_MODEL_ID,
  voiceProfile: null,
};

const SETTINGS_PATH = `${documentDirectory}llm-settings.json`;

let cache: LlmSettings | null = null;

export async function getLlmSettings(): Promise<LlmSettings> {
  if (cache) {
    return cache;
  }
  try {
    const raw = await readAsStringAsync(SETTINGS_PATH);
    const parsed = JSON.parse(raw) as Partial<LlmSettings>;
    cache = {
      onDeviceCuration: parsed.onDeviceCuration === true,
      modelId:
        typeof parsed.modelId === "string" && parsed.modelId.length > 0
          ? parsed.modelId
          : DEFAULTS.modelId,
      voiceProfile:
        typeof parsed.voiceProfile === "string" ? parsed.voiceProfile : null,
    };
  } catch {
    // Missing or corrupt file — fall back to defaults (curation off).
    cache = { ...DEFAULTS };
  }
  return cache;
}

export async function updateLlmSettings(
  patch: Partial<LlmSettings>,
): Promise<LlmSettings> {
  const current = await getLlmSettings();
  const next = { ...current, ...patch };
  cache = next;
  try {
    await writeAsStringAsync(SETTINGS_PATH, JSON.stringify(next));
  } catch {
    // Persistence is best-effort; the in-memory value still applies this session.
  }
  return next;
}
