import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchGuardedImage, isBlockedIp, resolveSafe } from "./safe-fetch";

describe("isBlockedIp — SSRF target ranges", () => {
  test("blocks loopback / unspecified", () => {
    for (const ip of ["127.0.0.1", "127.255.255.254", "0.0.0.0", "::1", "::"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  test("blocks the cloud metadata endpoint + link-local", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("169.254.0.1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  test("blocks RFC1918 private + CGNAT", () => {
    for (const ip of ["10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1", "100.64.0.1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  test("blocks IPv6 ULA + multicast", () => {
    for (const ip of ["fc00::1", "fd12:3456::1", "ff02::1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  test("blocks IPv4-mapped IPv6 forms of private/loopback addresses", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
  });

  test("blocks reserved / test / multicast IPv4", () => {
    for (const ip of ["224.0.0.1", "240.0.0.1", "255.255.255.255", "198.18.0.1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  test("blocks malformed input", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("999.1.1.1")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });

  test("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1::1"]) {
      expect(isBlockedIp(ip)).toBe(false);
    }
  });
});

describe("fetchGuardedImage", () => {
  let server: Server;
  let port = 0;
  // The last response the test server should send (per-test override).
  let respond: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void = () => {};

  beforeAll(async () => {
    server = createServer((req, res) => respond(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  // TEST-ONLY resolver: bypass the IP block so the pinned connection reaches the
  // loopback test server. Production callers never inject `resolve`.
  const toLoopback = async () => ["127.0.0.1"];
  const url = () => `http://images.test:${port}/cover.png`;

  test("(a) public host, image/png under the cap → returns bytes", async () => {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(body);
    };
    const out = await fetchGuardedImage(url(), {
      maxBytes: 1024,
      resolve: toLoopback,
    });
    expect(out).not.toBeNull();
    expect(out!.mediaType).toBe("image/png");
    expect(Buffer.from(out!.bytes).equals(body)).toBe(true);
  });

  test("(b) a blocked resolved IP → returns null (never connects)", async () => {
    // Real resolveSafe runs, but its DNS answer (injected) is the metadata IP,
    // so isBlockedIp rejects it → null.
    const out = await fetchGuardedImage("http://metadata.test/cover.png", {
      resolve: (h) => resolveSafe(h, async () => [{ address: "169.254.169.254" }]),
    });
    expect(out).toBeNull();
  });

  test("(c) oversize body → returns null", async () => {
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.alloc(64));
    };
    const out = await fetchGuardedImage(url(), {
      maxBytes: 16,
      resolve: toLoopback,
    });
    expect(out).toBeNull();
  });

  test("(d) non-image content-type → returns null", async () => {
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>nope</html>");
    };
    const out = await fetchGuardedImage(url(), {
      maxBytes: 1024,
      resolve: toLoopback,
    });
    expect(out).toBeNull();
  });
});
