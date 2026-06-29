import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Newsreader } from "next/font/google";
import "./tailwind.css";
import { SITE_NAME, SITE_URL } from "../lib/site";
import { ThemeProvider } from "./_theme/theme-provider";
import { ThemeScript } from "./_theme/theme-script";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const newsreader = Newsreader({
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${SITE_NAME} — Your life, in context.`,
  description:
    "Sirius is the life-context engine. Capture anything — links, photos, notes, repos, videos, documents, even voice memos — and AI drafts a clean, organized post you review and keep. Every capture becomes private context about your life. Private by default, yours to export.",
  applicationName: SITE_NAME,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-theme defaults to dark for SSR; ThemeScript reconciles it with the
    // stored preference before paint. suppressHydrationWarning covers that
    // pre-hydration attribute mutation.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${instrumentSerif.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
