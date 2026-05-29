import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type Session } from "@repo/auth";

// Memoized per request: under Cache Components the session is read from several
// independent dynamic boundaries (layout chrome, auth gate, pages), and React
// cache() dedupes those into a single getSession call per request.
export const getSessionOrNull = cache(
  async (): Promise<Session | null> => {
    return auth.api.getSession({ headers: await headers() });
  }
);

export async function requireSession(redirectTo?: string): Promise<Session> {
  const session = await getSessionOrNull();
  if (!session) {
    const next = redirectTo
      ? `?next=${encodeURIComponent(redirectTo)}`
      : "";
    redirect(`/sign-in${next}`);
  }
  return session;
}
