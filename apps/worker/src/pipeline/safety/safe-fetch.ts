// SSRF-hardened fetch for the ONE place the safety gate pulls a user-supplied
// URL server-side: downloading a PDF-by-link to scan it. A naive fetch here lets
// a user point the worker at cloud metadata (169.254.169.254), localhost, or any
// internal service. Defenses (all required — internal services are common SSRF
// targets):
//   1. scheme allowlist (http/https only)
//   2. DNS-resolve the host and reject if ANY answer is loopback / private /
//      link-local / unique-local / CGNAT / unspecified / multicast / reserved
//      (incl. IPv4-mapped IPv6 forms)
//   3. PIN the validated IP into the actual connection (connect to the literal
//      IP, SNI + Host header carry the original hostname) so DNS can't rebind to
//      an internal address between validation and fetch
//   4. REFUSE redirects (a 3xx Location could re-target an internal host)
//   5. enforce the size cap on the STREAMED body, not the attacker-controlled
//      Content-Length header
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { URL } from "node:url";

const FETCH_TIMEOUT_MS = 15_000;

// Reject an IPv4 literal that falls in any non-public range.
function isBlockedV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → block
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 (IETF/test)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100/24 test-net-2
  if (a === 203 && b === 0) return true; // 203.0.113/24 test-net-3
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false;
}

// Reject an IPv6 literal that is loopback / unspecified / link-local / ULA /
// multicast, or an IPv4-mapped/translated form whose embedded v4 is blocked.
function isBlockedV6(raw: string): boolean {
  const ip = raw.toLowerCase().split("%")[0]!; // strip zone id
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  if (ip.startsWith("fe80")) return true; // link-local fe80::/10
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA fc00::/7
  if (ip.startsWith("ff")) return true; // multicast ff00::/8
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) — extract the v4.
  const v4 = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4 && (ip.includes("::ffff:") || ip.startsWith("64:ff9b"))) {
    return isBlockedV4(v4[1]!);
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // not a valid IP → block
}

// Resolve every address for a host and return them, or null if any is blocked
// (an "any blocked → reject" policy also kills the public+private split trick).
// `lookupFn` is injectable for tests (feed a synthetic DNS answer through the
// REAL block check); production always uses node's resolver.
// A narrow view of node's `lookup(host, { all: true })` — just enough to inject
// a synthetic DNS answer in tests. Node's overloaded `lookup` is assignable to it.
type LookupAllFn = (
  hostname: string,
  opts: { all: true },
) => Promise<{ address: string }[]>;

export async function resolveSafe(
  hostname: string,
  lookupFn: LookupAllFn = lookup,
): Promise<string[] | null> {
  let answers: { address: string }[];
  try {
    answers = await lookupFn(hostname, { all: true });
  } catch {
    return null;
  }
  if (answers.length === 0) return null;
  for (const a of answers) {
    if (isBlockedIp(a.address)) return null;
  }
  return answers.map((a) => a.address);
}

type GuardedFetchOptions = {
  maxBytes: number;
  accept: string;
  userAgent: string;
  // Returns true if the response Content-Type is acceptable. Receives the raw
  // header value (possibly empty). Rejecting → the fetch resolves null.
  isAllowedContentType: (contentType: string) => boolean;
  // Injectable resolver — TEST ONLY. Production callers omit it so the real
  // `resolveSafe` (with its DNS + IP-block) runs. A test may inject a resolver
  // that returns a loopback address to reach a local server; production never
  // does, so this is not an SSRF bypass in shipped code.
  resolve?: (hostname: string) => Promise<string[] | null>;
};

// Shared SSRF-hardened fetch core for both the PDF (safety scan) and image
// (cover/social localization) callers. Applies all defenses documented at the
// top of this file. Returns the streamed bytes + the response Content-Type, or
// null on any rejection (bad scheme, blocked host, redirect, disallowed type,
// over the size cap, network/timeout). Never throws.
async function fetchGuarded(
  rawUrl: string,
  opts: GuardedFetchOptions,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const addresses = await (opts.resolve ?? resolveSafe)(u.hostname);
  if (!addresses) return null;
  const pinnedIp = addresses[0]!; // pin a validated address (defeats rebinding)

  const isHttps = u.protocol === "https:";
  const lib = isHttps ? https : http;
  const port = u.port ? Number(u.port) : isHttps ? 443 : 80;
  // Host header must reflect the ORIGINAL host (with non-default port), not the IP.
  const hostHeader =
    (u.port && port !== (isHttps ? 443 : 80)) ? `${u.hostname}:${u.port}` : u.hostname;

  return new Promise<{ buffer: Buffer; contentType: string } | null>((resolve) => {
    let settled = false;
    const done = (val: { buffer: Buffer; contentType: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const req = lib.request(
      {
        host: pinnedIp, // connect to the PINNED ip, not a re-resolved hostname
        servername: isHttps ? u.hostname : undefined, // SNI + cert validation vs hostname
        port,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          Host: hostHeader,
          Accept: opts.accept,
          "User-Agent": opts.userAgent,
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Refuse redirects outright — a Location could re-target an internal host.
        if (status >= 300 && status < 400) {
          res.destroy();
          return done(null);
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          return done(null);
        }
        const ct = String(res.headers["content-type"] ?? "");
        if (!opts.isAllowedContentType(ct)) {
          res.destroy();
          return done(null);
        }
        const advertised = Number(res.headers["content-length"]);
        if (Number.isFinite(advertised) && advertised > opts.maxBytes) {
          res.destroy();
          return done(null);
        }
        // Cap against the STREAMED bytes (Content-Length is attacker-controlled).
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > opts.maxBytes) {
            res.destroy();
            req.destroy();
            return done(null);
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          done(total === 0 ? null : { buffer: Buffer.concat(chunks), contentType: ct }),
        );
        res.on("error", () => done(null));
      },
    );

    req.on("timeout", () => {
      req.destroy();
      done(null);
    });
    req.on("error", () => done(null));
    req.end();
  });
}

// Download a PDF from a user-supplied URL with all the SSRF defenses above.
// Returns the bytes, or null on any rejection (bad scheme, blocked host, redirect,
// non-PDF, over the size cap, network/timeout). Never throws.
export async function fetchGuardedPdf(
  rawUrl: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const result = await fetchGuarded(rawUrl, {
    maxBytes,
    accept: "application/pdf",
    userAgent: "sirius-safety-scan",
    // Preserve prior behavior: an empty Content-Type is allowed; a present one
    // must be PDF or a generic octet-stream.
    isAllowedContentType: (ct) =>
      !ct || /application\/pdf|application\/octet-stream/i.test(ct),
  });
  return result ? result.buffer : null;
}

const DEFAULT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
// Allowlisted image Content-Types (matches extFromContentType in post-writer).
const ALLOWED_IMAGE_CT = /^image\/(jpe?g|png|webp|gif|avif)\b/i;

// Download a bitmap image from a user-supplied URL with all the SSRF defenses
// above, plus an image Content-Type allowlist. Returns the bytes + normalized
// media type (e.g. "image/jpeg"), or null on any rejection (bad scheme, blocked
// host, redirect, non-image/unknown Content-Type, over the size cap,
// network/timeout). Never throws.
export async function fetchGuardedImage(
  rawUrl: string,
  opts?: {
    maxBytes?: number;
    // TEST ONLY — see GuardedFetchOptions.resolve. Production callers omit it.
    resolve?: (hostname: string) => Promise<string[] | null>;
  },
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  const result = await fetchGuarded(rawUrl, {
    maxBytes: opts?.maxBytes ?? DEFAULT_IMAGE_MAX_BYTES,
    accept: "image/*",
    // A browser-ish UA — some image CDNs (incl. Instagram/X) 403 unknown agents.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    // Require a recognized image type — reject empty/unknown (unlike the PDF path).
    isAllowedContentType: (ct) => ALLOWED_IMAGE_CT.test(ct),
    resolve: opts?.resolve,
  });
  if (!result) return null;
  // Normalize to a bare, lowercased media type (strip params; jpg → jpeg).
  const base = result.contentType.split(";")[0]!.trim().toLowerCase();
  const mediaType = base === "image/jpg" ? "image/jpeg" : base;
  return { bytes: new Uint8Array(result.buffer), mediaType };
}
