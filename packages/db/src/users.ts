// User storefront helpers. The handle is the public URL slug for a user's
// catalog page (/catalog/<handle>) and is enforced to be lowercase + URL-safe.
import { sanitizeVoiceProfile } from "@repo/ingest-draft";

import { Prisma } from "../generated/prisma";
import { HANDLE_REGEX, validateHandle } from "./handle-policy";
import { prisma } from "./index";

const UNIQUE_VIOLATION = "P2002";

// Display-name bounds. Mirrors the Zod schema on /api/app/me/name so the domain
// helper owns the invariant too (callers can't bypass it by hitting Prisma
// directly). Whitespace is collapsed before length is measured.
export const USER_NAME_MAX_CHARS = 80;

export function normalizeUserName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export type StorefrontUser = {
  id: string;
  name: string;
  handle: string;
  bio: string | null;
  location: string | null;
  image: string | null;
};

export async function findUserByHandle(
  handle: string,
): Promise<StorefrontUser | null> {
  const lower = handle.trim().toLowerCase();
  if (!HANDLE_REGEX.test(lower)) {
    return null;
  }
  const row = await prisma.user.findUnique({
    where: { handle: lower },
    select: {
      id: true,
      name: true,
      handle: true,
      bio: true,
      location: true,
      image: true,
    },
  });
  if (!row || !row.handle) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    bio: row.bio,
    location: row.location,
    image: row.image,
  };
}

export type SetHandleResult =
  | { ok: true; handle: string }
  | { ok: false; reason: "invalid" | "reserved" | "taken" };

export async function setUserHandle(
  userId: string,
  handle: string,
): Promise<SetHandleResult> {
  const validation = validateHandle(handle);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }
  const lower = validation.handle;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { handle: lower },
    });
    return { ok: true, handle: lower };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      return { ok: false, reason: "taken" };
    }
    throw error;
  }
}

export async function getUserHandle(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true },
  });
  return row?.handle ?? null;
}

export type SetNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: "invalid" };

export async function setUserName(
  userId: string,
  name: string,
): Promise<SetNameResult> {
  const cleaned = normalizeUserName(name);
  if (cleaned.length < 1 || cleaned.length > USER_NAME_MAX_CHARS) {
    return { ok: false, reason: "invalid" };
  }
  await prisma.user.update({
    where: { id: userId },
    data: { name: cleaned },
  });
  return { ok: true, name: cleaned };
}

// Email + display name for a user — used by the worker to address the
// archive-ready notification.
export async function getUserContact(
  userId: string,
): Promise<{ email: string; name: string } | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  return row ? { email: row.email, name: row.name } : null;
}

export async function getVoiceProfile(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { voiceProfile: true },
  });
  return row?.voiceProfile ?? null;
}

export async function setVoiceProfile(
  userId: string,
  text: string,
): Promise<{ ok: true; voiceProfile: string | null }> {
  const cleaned = sanitizeVoiceProfile(text);
  const value = cleaned.length > 0 ? cleaned : null;
  await prisma.user.update({
    where: { id: userId },
    data: { voiceProfile: value },
  });
  return { ok: true, voiceProfile: value };
}
