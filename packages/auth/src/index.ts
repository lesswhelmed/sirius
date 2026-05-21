import { expo } from "@better-auth/expo";
import { prisma } from "@repo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";

import { sendEmail } from "./email";

const isProduction = process.env.NODE_ENV === "production";

// Comma-separated list of additional origins allowed to call the auth API.
// BETTER_AUTH_URL is included automatically; only list extras here.
const extraTrustedOrigins = (process.env.AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins: extraTrustedOrigins,
  advanced: {
    useSecureCookies: isProduction,
  },
  rateLimit: {
    enabled: isProduction,
    storage: "database",
    window: 60,
    max: 100,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      if (!isProduction) {
        console.log(`[auth] reset-password URL for ${user.email}: ${url}`);
      }
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        html: `<p>Hi ${user.name ?? "there"},</p>
<p>Click the link below to reset your password:</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (!isProduction) {
        console.log(`[auth] verify-email URL for ${user.email}: ${url}`);
      }
      await sendEmail({
        to: user.email,
        subject: "Verify your email",
        html: `<p>Welcome, ${user.name ?? "there"}!</p>
<p>Click the link below to verify your email address:</p>
<p><a href="${url}">${url}</a></p>`,
      });
    },
  },
  plugins: [admin(), expo(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
