import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionOrNull } from "../lib/session";

export default function Home() {
  // The redirect target depends on the session (dynamic), so it lives inside a
  // Suspense boundary to satisfy Cache Components.
  return (
    <Suspense fallback={null}>
      <Redirector />
    </Suspense>
  );
}

async function Redirector() {
  const session = await getSessionOrNull();
  // Signed-in owners land in the app; everyone else meets the marketing page.
  redirect(session ? "/ingest" : "/product");
  return null; // unreachable: redirect() throws, but satisfies the JSX return type
}
