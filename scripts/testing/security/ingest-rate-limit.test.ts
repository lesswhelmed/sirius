// Blackbox regression for the bearer-ingest rate-limit hardening (finding:
// leaked INGEST_TOKEN → unlimited AI spend/flood). Covers all three primitives:
//   1. the pure `rateLimit` fixed-window core,
//   2. the web-edge `enforceBearerRateLimit` throttle (synthetic Request),
//   3. the worker `consumeBearerAiGeneration` AI cap.
// No real sleeps: time is driven with bun's setSystemTime.
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";

import { enforceBearerRateLimit } from "../../../apps/web/lib/ingest/auth";
import { rateLimit } from "../../../apps/web/lib/rate-limit";
import {
  consumeBearerAiGeneration,
  resetBearerMeter,
} from "../../../apps/worker/src/pipeline/bearer-meter";

afterEach(() => {
  // Restore the real clock between tests so state seeded at a faked time can't
  // leak into the next case.
  setSystemTime();
});

function bearerRequest(opts: { ip?: string; token?: string }): Request {
  const headers = new Headers();
  if (opts.ip) {
    headers.set("x-forwarded-for", opts.ip);
  }
  headers.set("authorization", `Bearer ${opts.token ?? "test-token"}`);
  return new Request("https://sirius.local/api/ingest", {
    method: "POST",
    headers,
  });
}

describe("rateLimit (pure fixed-window core)", () => {
  test("allows up to max, rejects the overflow, resets after the window", () => {
    const base = new Date("2030-01-01T00:00:00Z").getTime();
    setSystemTime(new Date(base));
    const key = `rl-core-${Math.random()}`;

    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);

    const overflow = rateLimit(key, 3, 60_000);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.retryAfterMs).toBeGreaterThan(0);
    }

    // Advance past the window → the counter resets and traffic flows again.
    setSystemTime(new Date(base + 60_001));
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
  });
});

describe("enforceBearerRateLimit (web edge throttle)", () => {
  test("a per-caller burst trips 429; distinct IPs and tokens are independent", () => {
    process.env.INGEST_RL_PER_MAX = "3";
    process.env.INGEST_RL_GLOBAL_MAX = "100000"; // don't let global trip first
    const base = new Date("2030-02-01T00:00:00Z").getTime();
    setSystemTime(new Date(base));

    const reqA = bearerRequest({ ip: "9.9.9.1", token: "token-A" });
    expect(enforceBearerRateLimit(reqA, "post").ok).toBe(true);
    expect(enforceBearerRateLimit(reqA, "post").ok).toBe(true);
    expect(enforceBearerRateLimit(reqA, "post").ok).toBe(true);

    const tripped = enforceBearerRateLimit(reqA, "post");
    expect(tripped.ok).toBe(false);
    if (!tripped.ok) {
      expect(tripped.status).toBe(429);
      expect(tripped.retryAfterMs).toBeGreaterThan(0);
      expect(tripped.scope).toBe("caller");
    }

    // Same token, different IP → its own window, not throttled.
    const reqDiffIp = bearerRequest({ ip: "9.9.9.2", token: "token-A" });
    expect(enforceBearerRateLimit(reqDiffIp, "post").ok).toBe(true);

    // Same IP, different token → its own window, not throttled.
    const reqDiffToken = bearerRequest({ ip: "9.9.9.1", token: "token-B" });
    expect(enforceBearerRateLimit(reqDiffToken, "post").ok).toBe(true);
  });

  test("the pre-auth IP guard trips independently of the token", () => {
    process.env.INGEST_RL_PER_MAX = "2";
    const base = new Date("2030-03-01T00:00:00Z").getTime();
    setSystemTime(new Date(base));

    const req = bearerRequest({ ip: "9.9.9.9" });
    expect(enforceBearerRateLimit(req, "pre").ok).toBe(true);
    expect(enforceBearerRateLimit(req, "pre").ok).toBe(true);

    const tripped = enforceBearerRateLimit(req, "pre");
    expect(tripped.ok).toBe(false);
    if (!tripped.ok) {
      expect(tripped.status).toBe(429);
      expect(tripped.scope).toBe("ip");
    }

    // Reset the window → guard clears.
    setSystemTime(new Date(base + 60_001));
    expect(enforceBearerRateLimit(req, "pre").ok).toBe(true);
  });
});

describe("consumeBearerAiGeneration (worker AI cap)", () => {
  test("N allowed then capped, and the window resets", () => {
    process.env.BEARER_AI_WINDOW_MAX = "3";
    process.env.BEARER_AI_WINDOW_MS = "1000";
    const base = new Date("2031-01-01T00:00:00Z").getTime();
    setSystemTime(new Date(base));
    resetBearerMeter();

    expect(consumeBearerAiGeneration().allowed).toBe(true);
    expect(consumeBearerAiGeneration().allowed).toBe(true);
    expect(consumeBearerAiGeneration().allowed).toBe(true);

    const capped = consumeBearerAiGeneration();
    expect(capped.allowed).toBe(false);
    if (!capped.allowed) {
      expect(capped.used).toBe(3);
      expect(capped.limit).toBe(3);
      expect(capped.retryAfterMs).toBeGreaterThan(0);
    }

    // Advance past the window → the meter resets and drafting resumes.
    setSystemTime(new Date(base + 1001));
    expect(consumeBearerAiGeneration().allowed).toBe(true);
  });
});
