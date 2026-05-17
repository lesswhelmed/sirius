import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type Session } from "@repo/auth";

export async function getSessionOrNull(): Promise<Session | null> {
  return auth.api.getSession({ headers: await headers() });
}

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
