import { describe, expect, test } from "bun:test";
import { isBlockedIp } from "./safe-fetch";

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
