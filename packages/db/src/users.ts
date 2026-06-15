// User storefront helpers. The handle is the public URL slug for a user's
// catalog page (/catalog/<handle>) and is enforced to be lowercase + URL-safe.
import { Prisma } from "../generated/prisma";
import { prisma } from "./index";

const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;
const UNIQUE_VIOLATION = "P2002";

export type StorefrontUser = {
  id: string;
  name: string;
  handle: string;
  bio: string | null;
  location: string | null;
  image: string | null;
};

export async function findUserByHandle(
  handle: string
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
  | { ok: false; reason: "invalid" | "taken" };

export async function setUserHandle(
  userId: string,
  handle: string
): Promise<SetHandleResult> {
  const lower = handle.trim().toLowerCase();
  if (!HANDLE_REGEX.test(lower)) {
    return { ok: false, reason: "invalid" };
  }
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

// Email + display name for a user — used by the worker to address the
// archive-ready notification.
export async function getUserContact(
  userId: string
): Promise<{ email: string; name: string } | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  return row ? { email: row.email, name: row.name } : null;
}
