// Side-effect module: arms crash capture as the VERY FIRST thing that runs at
// launch. It MUST be the first import of the root layout (before `@/polyfills`
// and everything else).
//
// Why a separate module instead of just calling installCrashCapture() in the
// layout body: ES module imports are hoisted and evaluated — in source order —
// BEFORE any statement in the importing module. So a plain call in _layout.tsx
// still runs AFTER every top-of-file import's side effects (polyfills, the
// SQLite open, the auth client, purchases, the sync engine, the outbox task).
// A throw during any of those early evaluations would fire before the hook was
// installed → expo-updates' ErrorRecovery re-throws it as an opaque SIGABRT and
// our LastCrashBanner never sees it. Importing THIS module first makes the hook
// the earliest side effect, so those early throws are recorded too.
import { installCrashCapture } from "@/lib/crash-log";

installCrashCapture();
