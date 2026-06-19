#!/usr/bin/env bun
// Reset a user's password directly in Postgres (bypasses the email reset flow).
// Uses Better Auth's credential hash so sign-in works immediately.
//
// Run from repo root (reads root `.env` for DATABASE_URL):
//   bun run auth:reset-password user@example.com
//   NEW_PASSWORD='secret' bun run auth:reset-password user@example.com
//   bun run auth:reset-password user@example.com --password 'secret'
//   bun run auth:reset-password user@example.com --no-revoke-sessions

import { randomBytes } from "node:crypto";
import { prisma } from "@repo/db";
import { hashPassword } from "better-auth/crypto";

type ParsedArgs = {
  email?: string;
  password?: string;
  revokeSessions: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let email: string | undefined;
  let password: string | undefined;
  let revokeSessions = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--password") {
      password = argv[++i];
      continue;
    }
    if (arg.startsWith("--password=")) {
      password = arg.slice("--password=".length);
      continue;
    }
    if (arg === "--no-revoke-sessions") {
      revokeSessions = false;
      continue;
    }
    if (!arg.startsWith("-")) {
      email = arg;
    }
  }

  password ??= process.env.NEW_PASSWORD;

  return { email, password, revokeSessions };
}

function usage(): never {
  console.error(
    "Usage: bun run auth:reset-password <email> [--password <pwd>] [--no-revoke-sessions]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const {
    email,
    password: suppliedPassword,
    revokeSessions,
  } = parseArgs(process.argv.slice(2));

  if (!email) usage();

  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    console.error(`No user found for ${normalizedEmail}`);
    process.exit(1);
  }

  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });

  if (!account) {
    console.error(
      `User ${normalizedEmail} has no credential (email/password) account`,
    );
    process.exit(1);
  }

  const password = suppliedPassword ?? randomBytes(16).toString("base64url");
  const generated = !suppliedPassword;

  if (password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }

  const hashed = await hashPassword(password);

  await prisma.account.updateMany({
    where: { userId: user.id, providerId: "credential" },
    data: { password: hashed, updatedAt: new Date() },
  });

  if (revokeSessions) {
    const { count } = await prisma.session.deleteMany({
      where: { userId: user.id },
    });
    console.log(`Revoked ${count} session(s).`);
  }

  console.log(`Password reset for ${user.email} (${user.id}).`);
  if (generated) {
    console.log(`Generated password: ${password}`);
    console.log("Save it now — it won't be shown again.");
  } else {
    console.log("Password updated.");
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
