// Inquiry table helpers. Inquiries are leads sent from a catalog visitor to the
// post's submitter ("seller"). The row persists even if Resend fails — the seller
// can still see it in their inbox.
import { Prisma } from "../generated/prisma";
import { prisma } from "./index";
import type { PageResult } from "./ingest";

export type Inquiry = Prisma.InquiryGetPayload<Record<string, never>>;

export interface CreateInquiryInput {
  postId: string;
  sellerId: string;
  fromUserId?: string | null;
  fromEmail: string;
  fromName?: string | null;
  message: string;
}

export async function createInquiry(input: CreateInquiryInput): Promise<Inquiry> {
  return prisma.inquiry.create({
    data: {
      postId: input.postId,
      sellerId: input.sellerId,
      fromUserId: input.fromUserId ?? null,
      fromEmail: input.fromEmail,
      fromName: input.fromName ?? null,
      message: input.message,
    },
  });
}

export async function markInquiryEmailSent(id: string): Promise<void> {
  await prisma.inquiry.update({
    where: { id },
    data: { emailSentAt: new Date() },
  });
}

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

export interface ListInquiriesOptions {
  status?: "open" | "closed";
  limit?: number;
  cursor?: string;
}

export type InquiryWithPost = Inquiry & {
  post: {
    id: string;
    slug: string;
    title: string;
    imageUrl: string | null;
  };
};

export async function listInquiriesForSeller(
  sellerId: string,
  opts: ListInquiriesOptions = {}
): Promise<PageResult<InquiryWithPost>> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const where: Prisma.InquiryWhereInput = { sellerId };
  if (opts.status) {
    where.status = opts.status;
  }
  const items = await prisma.inquiry.findMany({
    where,
    take: take + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      post: { select: { id: true, slug: true, title: true, imageUrl: true } },
    },
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const last = trimmed[trimmed.length - 1];
  return {
    items: trimmed,
    nextCursor: hasMore && last ? last.id : null,
  };
}
