import { Redirect } from "expo-router";

// Queue is no longer a standalone tab — its "in flight" status board folded into
// the Catalog (see (tabs)/library.tsx). This top-level route keeps the legacy
// deep link `siriusapp://queue` resolving for back-compat by redirecting to the
// Catalog tab instead of 404ing. It lives at the stack root (not under (tabs)/)
// so it doesn't reappear as an orphaned native-tab screen.
export default function QueueRedirect() {
  return <Redirect href="/library" />;
}
