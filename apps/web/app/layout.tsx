import type { Metadata } from "next";
import localFont from "next/font/local";
import { Instrument_Serif, Newsreader } from "next/font/google";
import "./tailwind.css";
import "./globals.css";

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

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sirius — A Field Journal",
  description: "A field journal. Capture, refine, and publish your work.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${instrumentSerif.variable} ${newsreader.variable} ${geistMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
