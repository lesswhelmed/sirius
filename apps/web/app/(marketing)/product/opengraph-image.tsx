import { ImageResponse } from "next/og";

export const alt = "Sirius — Capture anything. Keep what matters.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand palette (dark theme values from tailwind.css). Kept literal here because
// the edge image runtime can't read CSS custom properties. System serif stands
// in for Instrument Serif so the build never depends on fetching a font binary.
const PAPER = "#15110d";
const INK = "#ece3d3";
const INK_SUBTLE = "#948775";
const ACCENT = "#d65f57";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'SF Mono', ui-monospace, Menlo, monospace";

export default function OgImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: PAPER,
        padding: "72px 80px",
        // Subtle oxblood vignette echoing the app's paper-grain glow.
        backgroundImage: `radial-gradient(ellipse 70% 60% at 10% 0%, rgba(214,95,87,0.10), transparent 60%)`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: MONO,
          fontSize: 22,
          letterSpacing: 6,
          textTransform: "uppercase",
          color: INK_SUBTLE,
        }}
      >
        <span>A personal content catalog</span>
        <span style={{ color: ACCENT }}>iOS · Web</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontFamily: SERIF,
            fontSize: 120,
            lineHeight: 1,
            letterSpacing: -2,
            color: INK,
          }}
        >
          Sirius<span style={{ color: ACCENT }}>.</span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontFamily: SERIF,
            fontSize: 52,
            lineHeight: 1.1,
            letterSpacing: -1,
            color: INK,
            maxWidth: 920,
          }}
        >
          Everything you capture, drafted into something worth keeping.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontFamily: MONO,
          fontSize: 22,
          letterSpacing: 4,
          textTransform: "uppercase",
          color: INK_SUBTLE,
        }}
      >
        <span style={{ color: ACCENT, fontSize: 28 }}>⁂</span>
        <span>Capture · Draft · Curate · Publish</span>
      </div>
    </div>,
    size,
  );
}
