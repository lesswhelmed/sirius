// Crash/error capture for TestFlight + production builds.
//
// Why this exists: expo-updates installs its own `ErrorRecovery` on top of RN's
// global error handler. When a JS error is thrown that RN marks fatal (an
// uncaught throw in a native callback, an unhandled promise rejection Hermes
// promotes, etc.), expo-updates intercepts it, tries to reload/roll back, and
// — if it can't recover — RE-THROWS to abort the process (SIGABRT). The native
// crash report then only shows expo-updates' re-throw, NOT the original JS
// error, so the real cause is invisible (see the crashlog: the crashed thread
// is `ErrorRecovery.crash()`, with no trace of what actually failed).
//
// This module makes the real error visible:
//   1. Wraps the global ErrorUtils handler (the channel expo-updates also taps)
//      so every fatal/non-fatal JS error is logged + persisted BEFORE we hand
//      off to the original handler (behavior is otherwise unchanged).
//   2. Tracks unhandled promise rejections (a common source of "phantom"
//      fatals) via the same record path.
//   3. Exposes `recordCrash` for the root <ErrorBoundary/> to log render-phase
//      errors React catches (those never reach ErrorUtils).
// The persisted record is surfaced on the NEXT launch (see <LastCrashBanner/>)
// so a tester can read/report it even when they can't pull device logs.
//
// Persistence writes synchronously via `File.write` (expo-file-system's new
// API) so the record hits disk BEFORE we hand control back to expo-updates'
// ErrorRecovery — which re-throws the fatal and aborts the process moments
// later. An async write can lose that race; the sync write closes it. We fall
// back to the legacy async write if the sync path is unavailable, and keep the
// last record in a module variable as a same-session fallback. (Render-phase
// errors are non-aborting and would flush either way.)
import { File } from "expo-file-system";
import {
  deleteAsync,
  documentDirectory,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

export type CrashRecord = {
  source: "global" | "unhandledRejection" | "render";
  name?: string;
  message: string;
  stack?: string;
  componentStack?: string;
  isFatal?: boolean;
  timestamp: string;
};

const CRASH_PATH = `${documentDirectory}last-crash.json`;

// Same-session fallback when the async write can't flush before an abort.
let lastInMemory: CrashRecord | null = null;
let installed = false;

function toRecord(
  source: CrashRecord["source"],
  error: unknown,
  extra?: { isFatal?: boolean; componentStack?: string },
): CrashRecord {
  const err = error as { name?: unknown; message?: unknown; stack?: unknown };
  return {
    source,
    name: typeof err?.name === "string" ? err.name : undefined,
    message:
      typeof err?.message === "string"
        ? err.message
        : typeof error === "string"
          ? error
          : safeStringify(error),
    stack: typeof err?.stack === "string" ? err.stack : undefined,
    componentStack: extra?.componentStack,
    isFatal: extra?.isFatal,
    // Date.now()/new Date() are fine in app code (the workflow-script ban does
    // not apply here); ISO string keeps the record human-readable.
    timestamp: new Date().toISOString(),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// Synchronously writes the serialized record to CRASH_PATH so it survives the
// abort that follows a fatal. Returns false (never throws) if the sync File API
// is unavailable, so the caller can fall back to the async legacy write.
function persistSync(payload: string): boolean {
  try {
    // `File.write` creates-or-overwrites; the extra create() is a guard for
    // runtimes where a bare write on a missing file throws.
    const file = new File(CRASH_PATH);
    file.write(payload);
    return true;
  } catch {
    try {
      const file = new File(CRASH_PATH);
      if (!file.exists) file.create();
      file.write(payload);
      return true;
    } catch {
      return false;
    }
  }
}

// Records an error: logs with a greppable tag, holds it in memory, and persists
// it for next-launch surfacing. Never throws (a throw here would be ironic).
export function recordCrash(
  source: CrashRecord["source"],
  error: unknown,
  extra?: { isFatal?: boolean; componentStack?: string },
): void {
  try {
    const record = toRecord(source, error, extra);
    lastInMemory = record;
    // Greppable in device logs / EAS build logs.
    console.error(
      `[crash:${source}]${record.isFatal ? " FATAL" : ""} ${record.name ?? "Error"}: ${record.message}`,
      record.stack ?? "",
      record.componentStack ?? "",
    );
    // Sync write first (wins the race against the imminent abort); fall back to
    // the async legacy write only if the sync path is unavailable.
    const payload = JSON.stringify(record);
    if (!persistSync(payload)) {
      void writeAsStringAsync(CRASH_PATH, payload).catch(() => {});
    }
  } catch {
    // Swallow — instrumentation must never make things worse.
  }
}

// Installs the global hooks. Idempotent; safe to call before the React tree
// mounts (call it at module scope from the root layout).
export function installCrashCapture(): void {
  if (installed) return;
  installed = true;

  // 1. Global JS error handler — the same channel expo-updates' ErrorRecovery
  //    taps. We record, then delegate to the previous handler so the app's
  //    existing crash/recovery behavior is unchanged.
  try {
    const g = globalThis as {
      ErrorUtils?: {
        getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
        setGlobalHandler?: (
          handler: (error: unknown, isFatal?: boolean) => void,
        ) => void;
      };
    };
    const prev = g.ErrorUtils?.getGlobalHandler?.();
    g.ErrorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
      recordCrash("global", error, { isFatal });
      prev?.(error, isFatal);
    });
  } catch {
    // ErrorUtils unavailable — nothing to hook.
  }

  // 2. Unhandled promise rejections. RN bundles the `promise` polyfill with
  //    opt-in rejection tracking; enabling it routes otherwise-silent
  //    rejections (a frequent cause of "phantom" fatals) through recordCrash.
  try {
    // Dynamic require: the polyfill is optional and we must not let a missing/
    // renamed module break app launch — ErrorUtils still covers thrown errors.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require("promise/setimmediate/rejection-tracking");
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id: unknown, error: unknown) => {
        recordCrash("unhandledRejection", error);
      },
      onHandled: () => {},
    });
  } catch {
    // Polyfill shape changed / unavailable — ErrorUtils still covers throws.
  }
}

// Reads the persisted crash from a previous launch (null if none / unreadable).
export async function readLastCrash(): Promise<CrashRecord | null> {
  if (lastInMemory) return lastInMemory;
  try {
    const raw = await readAsStringAsync(CRASH_PATH);
    return JSON.parse(raw) as CrashRecord;
  } catch {
    return null;
  }
}

// Clears the persisted + in-memory crash (after the user has seen it).
export async function clearLastCrash(): Promise<void> {
  lastInMemory = null;
  try {
    await deleteAsync(CRASH_PATH, { idempotent: true });
  } catch {
    // Already gone / unwritable — nothing to do.
  }
}
