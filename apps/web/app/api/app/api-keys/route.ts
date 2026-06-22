import { auth } from "@repo/auth";
import { headers } from "next/headers";
import { z } from "zod";
import { getSessionOrNull } from "../../../../lib/session";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

// Shape returned to the client for an existing key. NEVER includes the hashed
// `key`; the plaintext is surfaced exactly once on create (see POST).
function publicKey(k: {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  createdAt: Date;
  lastRequest: Date | null;
  expiresAt: Date | null;
  enabled: boolean;
}) {
  return {
    id: k.id,
    name: k.name,
    // `prefix` is the configured key prefix; `start` is the first few chars of
    // the generated key — show whichever lets the user recognize the key.
    prefix: k.prefix ?? k.start,
    createdAt: k.createdAt,
    lastUsedAt: k.lastRequest,
    expiresAt: k.expiresAt,
    enabled: k.enabled,
  };
}

export async function GET() {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  // header-scoped → the plugin returns only the caller's keys, without `key`.
  const { apiKeys } = await auth.api.listApiKeys({ headers: await headers() });
  return Response.json({ keys: apiKeys.map(publicKey) });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  // Days until expiry; omitted/null = never expires. Converted to seconds for
  // the plugin's `expiresIn`.
  expiresInDays: z.number().int().min(1).max(3650).nullish(),
});

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
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const expiresIn =
    parsed.data.expiresInDays != null
      ? parsed.data.expiresInDays * 24 * 60 * 60
      : undefined;

  // header-scoped → the plugin attributes the key to the session user
  // (referenceId = session.user.id). The plaintext `key` is returned ONCE here.
  const created = await auth.api.createApiKey({
    body: {
      name: parsed.data.name,
      expiresIn: expiresIn ?? null,
      prefix: "sirius_",
    },
    headers: await headers(),
  });

  return Response.json(
    {
      // The one-time plaintext key. The client must surface it immediately;
      // it is never retrievable again.
      key: created.key,
      apiKey: publicKey(created),
    },
    { status: 201 },
  );
}
