import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "../../../lib/site";
import { Closing } from "./_sections/closing";
import { Features } from "./_sections/features";
import { Flow } from "./_sections/flow";
import { Hero } from "./_sections/hero";
import { Reveal } from "./_sections/reveal";
import { SellingPoints } from "./_sections/selling-points";
import { Transformation } from "./_sections/transformation";

const TITLE = "Sirius — Your life, in context.";
const DESCRIPTION =
  "Sirius is the life-context engine. Capture anything — links, photos, notes, repos, videos, documents, voice memos — and AI drafts a clean, structured post you review and keep. Every capture becomes private context about your life; the longer you use it, the more it understands. Private by default, yours to export. Feel lesswhelmed.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "life context",
    "context engine",
    "second brain",
    "capture",
    "notes",
    "bookmarks",
    "read later",
    "AI",
    "memory",
    "knowledge management",
    "research",
    "organize",
  ],
  alternates: { canonical: "/product" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/product`,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Structured data for rich results. Mirrors the App Store positioning.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "iOS, Web",
  url: `${SITE_URL}/product`,
  description: DESCRIPTION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@type": "Person", name: "Mina Saleeb" },
};

export default function ProductPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static, app-authored object — no user input is interpolated.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Hero />
      <Reveal>
        <Transformation />
      </Reveal>
      <Reveal>
        <Flow />
      </Reveal>
      <Reveal>
        <Features />
      </Reveal>
      <Reveal>
        <SellingPoints />
      </Reveal>
      <Reveal>
        <Closing />
      </Reveal>
    </>
  );
}
