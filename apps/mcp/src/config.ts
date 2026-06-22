// Env-derived config for the MCP corpus service. The service loads the
// repo-root `.env` the same way the worker does (Bun auto-loads the `.env`
// symlink in this app dir). We CANNOT import apps/worker's getClassifyConfig
// (cross-app ban), so the classify thresholds are re-read here from the same
// env vars with the same defaults as apps/worker/src/lib/ai-config.ts.

// Keep these in sync with apps/worker DEFAULT_PROJECT_MATCH_MIN /
// DEFAULT_CATEGORY_MATCH_MIN — the calibrated cosine cutoffs the classifier
// uses against gemini-embedding @ 768 dims.
const DEFAULT_PROJECT_MATCH_MIN = 0.78;
const DEFAULT_CATEGORY_MATCH_MIN = 0.58;

function envFloat(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export function getPort(): number {
  const raw = process.env.MCP_PORT;
  if (!raw) {
    return 3005;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3005;
}

export interface ClassifyThresholds {
  projectMatchMin: number;
  categoryMatchMin: number;
}

export function getClassifyThresholds(): ClassifyThresholds {
  return {
    projectMatchMin: envFloat(
      "CLASSIFY_PROJECT_MATCH_MIN",
      DEFAULT_PROJECT_MATCH_MIN,
    ),
    categoryMatchMin: envFloat(
      "CLASSIFY_CATEGORY_MATCH_MIN",
      DEFAULT_CATEGORY_MATCH_MIN,
    ),
  };
}

export function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[mcp] [${level}] ${msg}${payload}`);
}
