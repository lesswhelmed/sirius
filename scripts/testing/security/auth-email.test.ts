// Headless regression suite for two LOW auth-email hardening fixes, both in
// packages/auth/src/email.ts.
//
//   #7 email HTML injection — renderEmail() interpolates body strings verbatim
//      into <p>…</p>. escapeHtml(value) neutralizes user-controlled values at
//      the render boundary (a display name / handle in a verify/reset email is
//      attacker-influenced), turning <, >, &, ", ' into HTML entities so a
//      payload like <img onerror=…> can't inject markup into the email body.
//
//   #6 auth-token leak / fail-closed — sendEmail() builds a module-level `resend`
//      client from RESEND_API_KEY at import time. When no client exists it now
//      THROWS in production instead of console.log-ing the payload and returning
//      success. The payload `html` embeds LIVE single-use auth-token URLs
//      (password-reset / email-verification); the old behavior leaked them to
//      stdout/PM2 logs AND made Better Auth believe the send succeeded. Fail
//      closed: surface the misconfiguration, never log the token.
//
// Test design: `resend` is bound at module-load time from RESEND_API_KEY, but
// `isProduction` is read PER-CALL inside sendEmail. So we unset RESEND_API_KEY
// BEFORE importing (client === null — which also guarantees this test can never
// actually send email), then exercise BOTH branches on the same imported module
// by flipping NODE_ENV per call. No module-cache fight, so no test.skip needed.
//
// Run: bun test scripts/testing/security/auth-email.test.ts
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

// --- Control module-load-time env BEFORE importing the module under test. ---
const originalApiKey = process.env.RESEND_API_KEY;
const originalNodeEnv = process.env.NODE_ENV;

// No RESEND_API_KEY -> `const resend = ... : null` at import time. This is both
// the security-relevant configuration (no client) AND a hard guarantee that
// sendEmail can never reach `resend.emails.send(...)` and hit the network.
delete process.env.RESEND_API_KEY;
process.env.NODE_ENV = "production";

const { escapeHtml, sendEmail } = await import(
  "../../../packages/auth/src/email"
);

afterAll(() => {
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalApiKey;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("#7 escapeHtml — email HTML-injection guard", () => {
  test("neutralizes an <img onerror=…> XSS payload (no raw < or >)", () => {
    const out = escapeHtml("<img src=x onerror=alert(1)>");
    // The whole point: no raw angle brackets survive to open a real tag.
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toContain("&lt;img");
    expect(out).toContain("&gt;");
  });

  test("covers all five HTML entities", () => {
    // Ampersand is replaced first, so each single-char case is exact.
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  test("passes a benign display name through unchanged", () => {
    expect(escapeHtml("Ada Lovelace")).toBe("Ada Lovelace");
  });
});

describe("#6 sendEmail — production fail-closed (no auth-token leak)", () => {
  const TOKEN_URL =
    "https://sirius.local/reset-password?token=SECRET_LEAKY_TOKEN_123";
  const params = {
    to: "victim@example.com",
    subject: "Reset your password",
    html: `<a href="${TOKEN_URL}">Reset your password</a>`,
  };

  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    logSpy?.mockRestore();
    warnSpy?.mockRestore();
  });

  // Collapse every console.{log,warn} argument this call produced into one
  // searchable string so we can assert the token never escaped to stdout.
  const capturedOutput = (): string =>
    [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");

  test("rejects in production instead of returning success", async () => {
    process.env.NODE_ENV = "production";
    await expect(sendEmail(params)).rejects.toThrow(
      /RESEND_API_KEY not set in production/,
    );
  });

  test("logs NOTHING containing the auth-token URL on the prod path", async () => {
    process.env.NODE_ENV = "production";
    await expect(sendEmail(params)).rejects.toThrow();

    const output = capturedOutput();
    expect(output).not.toContain("SECRET_LEAKY_TOKEN_123");
    expect(output).not.toContain(TOKEN_URL);
    // Belt-and-suspenders: the no-client branch must not console.log at all in
    // prod (that log line is the dev-only recovery path).
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("dev path resolves (log-and-continue recovery), does NOT throw", async () => {
    // In development the misconfiguration is non-fatal: it warns and logs the
    // payload so the local dev can recover the verification/reset link.
    process.env.NODE_ENV = "development";
    await expect(sendEmail(params)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});
