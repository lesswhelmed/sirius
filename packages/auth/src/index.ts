import { apiKey } from "@better-auth/api-key";
import { expo } from "@better-auth/expo";
import { prisma } from "@repo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";

import { DEV_HOSTS } from "../dev-hosts.js";
import { purgeUserFiles } from "./delete-user-files";
import { escapeHtml, renderEmail, sendEmail } from "./email";

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
  // Surface the public-profile `handle` column on the session user so clients
  // (mobile especially, which only has the session — no DB access) can read it.
  // `input: false` keeps it read-only through the auth API: the handle is written
  // exclusively by setUserHandle (Prisma) via /setup-handle and /api/app/me/handle.
  user: {
    additionalFields: {
      handle: { type: "string", required: false, input: false },
      // App Store 1.2 (UGC): when the user agreed to the Terms of Use, so
      // clients can gate on session.user.termsAcceptedAt (null → show the
      // one-time acceptance screen). "date" is a supported DBFieldType
      // (@better-auth/core maps it to Date on the session). `input: false`
      // keeps it read-only through the auth API — it is stamped exclusively
      // server-side (sign-up + POST /api/app/account/accept-terms via Prisma).
      termsAcceptedAt: { type: "date", required: false, input: false },
    },
    // In-app account deletion (App Store Guideline 5.1.1(v)). Clients call
    // authClient.deleteUser({ password }); better-auth re-verifies the password
    // server-side, then deletes the User row — every user-owned table cascades
    // via `onDelete: Cascade` in the Prisma schema. The only thing the cascade
    // can't reach is on-disk files (retained originals + archive zips), so the
    // beforeDelete hook purges those first. Deletion is immediate and permanent
    // (no temporary deactivation, no email/customer-service step — Apple rejects
    // those). `request` is unused; the user.id is all purgeUserFiles needs.
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        purgeUserFiles(user.id);
      },
    },
  },
  // Stamp Terms-of-Use acceptance at registration (App Store 1.2 Part A). Both
  // sign-up UIs (web + mobile) require an explicit "I agree to the Terms of Use"
  // checkbox before submitting, so creating an account IS agreement — recorded
  // here server-side (termsAcceptedAt is input:false, unwritable via the auth
  // API). Pre-existing accounts (termsAcceptedAt null) get the one-time in-app
  // acceptance gate instead; the reviewer-account reset deliberately nulls this
  // column so App Review always sees that gate on sign-in.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Fail soft: this runs AFTER the user row is committed, so a throw
          // here doesn't roll the account back — it would only surface a bogus
          // sign-up error while leaving termsAcceptedAt null. Null just means
          // the user sees the one-time in-app acceptance gate on next sign-in,
          // so log and move on rather than failing the whole sign-up.
          try {
            await prisma.user.update({
              where: { id: user.id },
              data: { termsAcceptedAt: new Date() },
            });
          } catch (err) {
            console.error(
              `[auth] failed to stamp termsAcceptedAt for ${user.id} (user will see the acceptance gate):`,
              err,
            );
          }
        },
      },
    },
  },
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
            `Hi ${escapeHtml(user.name ?? "there")},`,
            "We received a request to reset the password on your Lesswhelmed account. Use the button below to choose a new one.",
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
            `Welcome, ${escapeHtml(user.name ?? "there")}!`,
            "Confirm your email address to finish setting up your Lesswhelmed account.",
          ],
          cta: { label: "Verify email", url },
          footnote:
            "If you didn't create a Lesswhelmed account, you can ignore this email.",
        }),
      });
    },
  },
  // apiKey() backs the MCP corpus server: users mint per-user API keys from
  // /settings; apps/mcp verifies a Bearer key → owning userId via
  // auth.api.verifyApiKey({ body: { key } }). Expiry/revoke/rate-limit are
  // enforced inside the plugin. Keep nextCookies() LAST (better-auth convention).
  // The @better-auth/api-key plugin names its model `apikey` (lowercase), but the
  // Prisma delegate is camelCase `prisma.apiKey` (table is @@map("apikey")). Without
  // this modelName override the prisma adapter calls db["apikey"] (undefined) and
  // every createApiKey/verifyApiKey 500s. Map it to the real delegate name.
  plugins: [
    admin(),
    expo(),
    apiKey({ schema: { apikey: { modelName: "apiKey" } } }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
