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

// In dev, trust the local web app, the portless dev URL (https://sirius.localhost,
// which the web app + iOS Simulator hit), the Expo web dev server (localhost:8081),
// and the native mobile deep-link scheme so logins aren't blocked as cross-origin.
// The Expo auth client (apps/mobile) calls back via `siriusapp://`, which better-auth's
// expo() plugin requires to be a trusted origin. `http://localhost:3000` is kept so a
// plain `PORTLESS=0` run (no proxy) still authenticates.
// Never applied in production, which stays locked to AUTH_TRUSTED_ORIGINS + BETTER_AUTH_URL
// — production deployments MUST include `siriusapp://` in AUTH_TRUSTED_ORIGINS.
const devTrustedOrigins = isProduction
  ? []
  : [
      "http://localhost:3000",
      "https://sirius.localhost",
      "http://localhost:8081",
      "siriusapp://",
    ];

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins: [...extraTrustedOrigins, ...devTrustedOrigins],
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
