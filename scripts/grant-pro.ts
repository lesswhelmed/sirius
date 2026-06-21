#!/usr/bin/env bun
// Manually grant (or revoke) "Sirius AI Pro" for one or more users, bypassing
// RevenueCat — for yourself, the team, comps, or support overrides. A grant with
// no --expires is effectively lifetime (unlimited server AI generations); the
// worker reads this entitlement via checkProStatus.
//
// Run from repo root (reads root `.env` for DATABASE_URL). On prod, run it on the
// server where the prod `.env` lives (same place deploy.sh runs):
//   bun run pro:grant you@example.com
//   bun run pro:grant a@x.com b@y.com            # several at once
//   bun run pro:grant you@example.com --expires 2027-01-01   # time-boxed comp
//   bun run pro:grant you@example.com --revoke               # turn Pro OFF
//
// Idempotent: re-running is safe. Verify with `bun run db:studio` (UserEntitlement).
import { prisma, setProEntitlement } from "@repo/db";

type ParsedArgs = {
  emails: string[];
  revoke: boolean;
  expiresAt: Date | null;
};

function parseArgs(argv: string[]): ParsedArgs {
  const emails: string[] = [];
  let revoke = false;
  let expiresAt: Date | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--revoke") {
      revoke = true;
      continue;
    }
    const expiresInline = arg.startsWith("--expires=")
      ? arg.slice("--expires=".length)
      : arg === "--expires"
        ? argv[++i]
        : undefined;
    if (expiresInline !== undefined) {
      const d = new Date(expiresInline);
      if (Number.isNaN(d.getTime())) {
        console.error(`Invalid --expires date: ${expiresInline}`);
        process.exit(1);
      }
      expiresAt = d;
      continue;
    }
    if (!arg.startsWith("-")) {
      emails.push(arg);
    }
  }

  return { emails, revoke, expiresAt };
}

function usage(): never {
  console.error(
    "Usage: bun run pro:grant <email> [<email>...] [--expires <ISO date>] [--revoke]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { emails, revoke, expiresAt } = parseArgs(process.argv.slice(2));
  if (emails.length === 0) usage();

  let failures = 0;
  for (const email of emails) {
    const normalized = email.toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true },
    });
    if (!user) {
      console.error(`✗ No user found for ${normalized}`);
      failures++;
      continue;
    }
    await setProEntitlement({
      userId: user.id,
      isPro: !revoke,
      expiresAt: revoke ? null : expiresAt,
    });
    if (revoke) {
      console.log(`✓ Revoked Sirius AI Pro for ${user.email} (${user.id})`);
    } else {
      const until = expiresAt ? `until ${expiresAt.toISOString()}` : "(lifetime)";
      console.log(`✓ Granted Sirius AI Pro to ${user.email} ${until}`);
    }
  }

  if (failures > 0) process.exit(1);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
