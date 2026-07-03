import { prisma } from "@repo/db";
import { getSessionOrNull } from "../../../../../lib/session";

// POST: record the signed-in user's agreement to the Terms of Use (App Store
// Guideline 1.2 Part A — the one-time acceptance gate for accounts created
// before the terms checkbox existed; new sign-ups are stamped at registration
// by the databaseHooks.user.create.after hook in @repo/auth). Idempotent:
// re-accepting simply refreshes the timestamp. termsAcceptedAt is `input:
// false` in the auth config, so this server-side Prisma write is the ONLY
// mutation path besides the sign-up hook.
export async function POST() {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { termsAcceptedAt: new Date() },
  });

  return Response.json({ ok: true });
}
