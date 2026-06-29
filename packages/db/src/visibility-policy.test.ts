import { describe, expect, test } from "bun:test";
import { publicTierPolicy } from "./visibility-policy";

// Pure unit test — no DB, no env, no preload. Covers all four flag combinations
// plus the load-bearing invariant: anonymousPublic === true must imply
// signedInPublic === true (anonymous exposure can never exceed signed-in).
describe("publicTierPolicy", () => {
  test("both off → nothing public", () => {
    expect(
      publicTierPolicy({
        publicCatalogEnabled: false,
        anonymousCatalogEnabled: false,
      }),
    ).toEqual({ signedInPublic: false, anonymousPublic: false });
  });

  test("public on, anonymous off → signed-in only", () => {
    expect(
      publicTierPolicy({
        publicCatalogEnabled: true,
        anonymousCatalogEnabled: false,
      }),
    ).toEqual({ signedInPublic: true, anonymousPublic: false });
  });

  test("public off, anonymous on → both on (anonymous implies signed-in)", () => {
    expect(
      publicTierPolicy({
        publicCatalogEnabled: false,
        anonymousCatalogEnabled: true,
      }),
    ).toEqual({ signedInPublic: true, anonymousPublic: true });
  });

  test("both on → both public", () => {
    expect(
      publicTierPolicy({
        publicCatalogEnabled: true,
        anonymousCatalogEnabled: true,
      }),
    ).toEqual({ signedInPublic: true, anonymousPublic: true });
  });

  test("anonymousPublic always implies signedInPublic", () => {
    for (const publicCatalogEnabled of [false, true]) {
      for (const anonymousCatalogEnabled of [false, true]) {
        const policy = publicTierPolicy({
          publicCatalogEnabled,
          anonymousCatalogEnabled,
        });
        if (policy.anonymousPublic) {
          expect(policy.signedInPublic).toBe(true);
        }
      }
    }
  });
});
