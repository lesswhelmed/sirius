import { expo } from "@better-auth/expo";
import { prisma } from "@repo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";

import { DEV_HOSTS } from "../dev-hosts.js";
import { renderEmail, sendEmail } from "./email";

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
      // Portless dev hostnames come from the ONE source of truth
      // (packages/auth/dev-hosts.js — also feeds next.config.js).
      ...DEV_HOSTS.map((host) => `https://${host}`),
      // Auth-only origins, not "dev hostnames": the PORTLESS=0 bypass, the
      // Expo web dev server, and the native deep-link scheme that
      // better-auth's expo() plugin requires.
      "http://localhost:3000",
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
        html: renderEmail({
          eyebrow: "New key",
          heading: "Reset your password.",
          body: [
            `Hi ${user.name ?? "there"},`,
            "We received a request to reset the password on your Sirius account. Use the button below to choose a new one.",
          ],
          cta: { label: "Set a new password", url },
          footnote:
            "This link expires in about an hour. If you didn't request a reset, you can safely ignore this email — your password stays unchanged.",
        }),
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
        html: renderEmail({
          eyebrow: "Welcome",
          heading: "Verify your email.",
          body: [
            `Welcome, ${user.name ?? "there"}!`,
            "Confirm your email address to finish setting up your Sirius account.",
          ],
          cta: { label: "Verify email", url },
          footnote:
            "If you didn't create a Sirius account, you can ignore this email.",
        }),
      });
    },
  },
  plugins: [admin(), expo(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
