import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "../../../lib/site";
import { Closing } from "./_sections/closing";
import { Features } from "./_sections/features";
import { Flow } from "./_sections/flow";
import { Hero } from "./_sections/hero";
import { Reveal } from "./_sections/reveal";
import { SellingPoints } from "./_sections/selling-points";
import { Transformation } from "./_sections/transformation";

const TITLE = "Sirius — Capture anything. Keep what matters.";
const DESCRIPTION =
  "Sirius is a personal content catalog. Capture links, photos, notes, repos, videos, documents, and voice memos; AI drafts a clean, organized post you review, then keep private or publish.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "content catalog",
    "capture",
    "notes",
    "bookmarks",
    "read later",
    "AI",
    "summary",
    "knowledge management",
    "publishing",
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
