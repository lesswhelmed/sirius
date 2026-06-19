import { getVoiceProfile, setVoiceProfile } from "@repo/db";
import { VOICE_PROFILE_MAX_CHARS } from "@repo/ingest-draft";
import { z } from "zod";

import { getSessionOrNull } from "../../../../../lib/session";

const voiceSchema = z.object({
  voiceProfile: z.string().max(VOICE_PROFILE_MAX_CHARS),
});

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const voiceProfile = await getVoiceProfile(session.user.id);
  return Response.json({ voiceProfile });
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = voiceSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const result = await setVoiceProfile(session.user.id, parsed.data.voiceProfile);
  return Response.json({ voiceProfile: result.voiceProfile });
}
