// Server sync for the user's "author voice" (see packages/ingest-draft/src/voice.ts).
// The server (User.voiceProfile via /api/app/me/voice) is the source of truth; we
// mirror the canonical value into the on-device llm-settings.json cache so the
// on-device drafting path can apply the same voice offline. Both calls soft-fail:
// the network may be down, but the UI must still render — callers surface errors.
import { apiGet, apiPostJson } from "./api";
import { updateLlmSettings } from "./llm/settings";

type VoiceResponse = { voiceProfile: string | null };

// GET the canonical voice from the server, refresh the local cache, and return
// it as a plain string ("" when unset). Throws on a hard failure so the caller
// can show an error state; on success it has already mirrored the value locally.
export async function fetchVoiceProfile(): Promise<string> {
  const res = await apiGet<VoiceResponse>("/api/app/me/voice");
  const voiceProfile = res?.voiceProfile ?? null;
  // Best-effort cache refresh so offline on-device drafting sees the same voice.
  await updateLlmSettings({ voiceProfile });
  return voiceProfile ?? "";
}

// POST the edited voice; the server sanitizes + length-caps it and returns the
// canonical stored value (which may differ from what we sent). Mirror THAT into
// the cache and return it so the UI shows exactly what was saved.
export async function saveVoiceProfile(text: string): Promise<string> {
  const res = await apiPostJson<VoiceResponse>("/api/app/me/voice", {
    voiceProfile: text,
  });
  const voiceProfile = res?.voiceProfile ?? null;
  await updateLlmSettings({ voiceProfile });
  return voiceProfile ?? "";
}
