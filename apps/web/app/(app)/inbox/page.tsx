import Link from "next/link";
import { listInquiriesForSeller } from "@repo/db";

import { requireSession } from "../../../lib/session";
import { DateDisplay } from "../../../lib/date-display";

export default async function InboxPage() {
  const session = await requireSession("/inbox");
  const { items } = await listInquiriesForSeller(session.user.id, { limit: 100 });

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Section IV — Correspondence
          </p>
          <h1 className="mt-1 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[48px]">
            Inbox<span className="text-[var(--color-accent)]">.</span>
          </h1>
          <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
            Notes from buyers about your listings. Reply to them directly by
            email — Sirius simply delivers the introduction.
          </p>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display italic text-[36px] leading-none text-[var(--color-accent)] nums-oldstyle">
            {items.length}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            inquiries
          </span>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="mt-10 border-y border-[var(--color-rule)] py-20 text-center">
          <p className="font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">
            No notes yet.
          </p>
          <p className="mt-3 text-[15px] text-[var(--fg-subtle)]">
            Once a visitor inquires about one of your listings, it will appear
            here.
          </p>
        </div>
      ) : (
        <ol className="mt-8 flex flex-col gap-6">
          {items.map((inquiry) => (
            <li
              key={inquiry.id}
              className="border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)]/40 p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                <Link
                  href={`/listing/${inquiry.post.slug}`}
                  className="font-display italic text-[20px] tracking-tight text-[var(--fg)] hover:text-[var(--color-accent)]"
                >
                  {inquiry.post.title}
                </Link>
                <DateDisplay value={inquiry.createdAt} variant="date-time" />
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                From {inquiry.fromName ?? "—"} ·{" "}
                <a
                  href={`mailto:${inquiry.fromEmail}?subject=${encodeURIComponent(
                    `Re: ${inquiry.post.title}`,
                  )}`}
                  className="text-[var(--color-accent)] underline underline-offset-4"
                >
                  {inquiry.fromEmail}
                </a>
              </p>
              <p className="mt-4 whitespace-pre-wrap font-body text-[16px] leading-relaxed text-[var(--fg)]">
                {inquiry.message}
              </p>
              <div className="mt-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                <span>
                  {inquiry.emailSentAt
                    ? "Email delivered"
                    : "Email pending — note saved"}
                </span>
                <span className={inquiry.status === "open" ? "text-[var(--color-sage)]" : ""}>
                  {inquiry.status}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
