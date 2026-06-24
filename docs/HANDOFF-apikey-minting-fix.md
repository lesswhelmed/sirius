# HANDOFF — better-auth API-key minting/verify is broken (500)

**Discovered by:** MossyStork (claude-code) on 2026-06-24 while blackbox-testing
the new `plugins/sirius-research` plugin against the `apps/mcp` corpus server.
**Severity:** blocks the entire `apps/mcp` MCP feature locally (and almost
certainly in prod) — no API key can be minted or verified.
**Status:** ✅ **RESOLVED** — fix landed in commit `9fcea30` (on `main`,
pushed + deployed 2026-06-24). Minting/verify confirmed working end-to-end
(local + prod has 0 legacy keys, so no backfill was needed). A related rate-limit
default (1000 req/hour at mint) landed in `1c19132`. Kept for the record.

---

_Original report (root-caused, one-line fix proposed, awaiting owner approval):_

## Symptom

- `POST /api/app/api-keys` (the documented mint flow in
  `apps/web/app/api/app/api-keys/route.ts`) returns **HTTP 500** for a valid
  signed-in session (sign-in itself returns 200).
- Server-side `auth.api.createApiKey({ body: { userId, ... } })` throws:
  ```
  [Better Auth]: Failed to delete expired API keys: TypeError: undefined is not
    an object (evaluating 'db[model].deleteMany')
  Model apikey does not exist in the database. If you haven't generated the
    Prisma client, you need to run 'npx prisma generate'
  ```

## Root cause (NOT a missing migration / client)

All the pieces exist:
- `packages/db/prisma/schema.prisma` → `model ApiKey { ... @@map("apikey") }`
- generated client has the delegate `prisma.apiKey` (camelCase)
- the `apikey` table exists in the DB (`SELECT to_regclass('public.apikey')` → `apikey`)

The mismatch is a **model-name → Prisma-delegate** resolution bug:

- `@better-auth/api-key` defines its model with the all-lowercase name
  **`apikey`** (see `node_modules/@better-auth/api-key/dist/index.mjs`,
  `apiKeySchema = (...) => ({ apikey: { fields: {...} } })`).
- `@better-auth/prisma-adapter` resolves a model to a delegate with
  `db[getModelName(model)]` (see its `dist/index.mjs`). For `apikey` that is
  `db["apikey"]`, which is **undefined** — the real Prisma delegate is
  `db["apiKey"]`.
- Single-word models (`user`, `session`, `account`, `verification`) work because
  their lowercase name equals their delegate name. `rateLimit` happens to match
  camelCase too. **`apikey` is the only model whose better-auth name differs
  from the Prisma delegate**, so it is the only one that breaks.

This breaks every apikey operation: `createApiKey`, the background
`deleteAllExpiredApiKeys` cleanup, and **`verifyApiKey`** (so the live MCP
server on `:4269` cannot authenticate any key either).

## Proposed fix (minimal, migration-free)

`packages/auth/src/index.ts` — pass a `schema` override to `apiKey()` so the
plugin's model name matches the Prisma delegate. The plugin merges this via
`mergeSchema(apiKeySchema(...), options.schema)`.

```diff
- plugins: [admin(), expo(), apiKey(), nextCookies()],
+ plugins: [
+   admin(),
+   expo(),
+   // Map the apiKey plugin's lowercase model name ("apikey") to the camelCase
+   // Prisma delegate (`prisma.apiKey`; table is @@map("apikey")). Without this
+   // the prisma adapter calls db["apikey"] (undefined) → every mint/verify 500s.
+   apiKey({ schema: { apikey: { modelName: "apiKey" } } }),
+   nextCookies(),
+ ],
```

No schema change, no migration, no `db:generate`. The Prisma model
(`ApiKey`/`@@map("apikey")`) and the `apikey` table are untouched.

## Verification (after applying)

1. Web flow:
   ```sh
   # sign in, then:
   curl -sk -b <cookies> -X POST https://sirius.local/api/app/api-keys \
     -H 'content-type: application/json' -d '{"name":"smoke"}' -w '\n%{http_code}\n'
   # expect 201 + a "sirius_..." key (was 500)
   ```
2. Plugin blackbox smoke (mints a reviewer key + exercises all 9 tools / 2
   resources / 3 prompts against the running `:4269` server):
   ```sh
   SIRIUS_MCP_API_KEY=<minted-key> SIRIUS_MCP_URL=http://localhost:4269/mcp \
     bash plugins/sirius-research/scripts/smoke.sh
   ```
3. Tenant isolation: with the reviewer's key, `get_post`/`browse_category` on a
   slug/path owned by another user must return `not found`.

## Notes / coordination

- Shared file: `packages/auth/src/index.ts`. Reserved by MossyStork via Agent
  Mail. `create-reviewer-account.ts` (touched by EmeraldCreek) depends on this
  working for any future key-based seeding.
- `apps/mcp/README.md` already flags "only end-to-end key smoke +
  tenant-isolation check left" — this is that gap; the smoke never passed
  because minting was broken.
