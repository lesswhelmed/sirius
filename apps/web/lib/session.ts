import { auth, type Session } from "@repo/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

// Memoized per request: under Cache Components the session is read from several
// independent dynamic boundaries (layout chrome, auth gate, pages), and React
// cache() dedupes those into a single getSession call per request.
export const getSessionOrNull = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() });
});

export async function requireSession(redirectTo?: string): Promise<Session> {
  const session = await getSessionOrNull();
  if (!session) {
    const next = redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : "";
    redirect(`/sign-in${next}`);
  }
  return session;
}

// App Store Guideline 1.2 (UGC) terms gate — SERVER-SIDE enforcement.
//
// The in-app terms-acceptance screen is UI-only: a signed-in session whose user
// has never accepted the Terms of Use (termsAcceptedAt == null) can still create
// or mutate UGC by calling the JSON APIs directly. So every UGC create/mutate
// route funnels through `agreedOr403` right after it resolves the session.
//
// `hasAcceptedTerms` is the pure decision (unit-testable in isolation, no request
// needed). `agreedOr403` is the route choke point: it returns a DISTINCT 403
// `{ error: "terms-required" }` Response when the gate blocks, or `null` to let
// the handler proceed. The distinct body (NOT a generic 401/"unauthorized")
// lets clients surface the "accept terms" prompt instead of a sign-in flow —
// clients must NOT auth-retry a terms-required 403.
export function hasAcceptedTerms(session: Session): boolean {
  return session.user.termsAcceptedAt != null;
}

export function agreedOr403(session: Session): Response | null {
  if (hasAcceptedTerms(session)) {
    return null;
  }
  return Response.json({ error: "terms-required" }, { status: 403 });
}
