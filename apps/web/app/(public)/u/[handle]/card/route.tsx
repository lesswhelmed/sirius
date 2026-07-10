// apps/web/app/(public)/u/[handle]/card/route.ts
import { ImageResponse } from "next/og";
import { findUserByHandle } from "@repo/db";
import { SITE_URL } from "../../../../../lib/site";

const PAPER = "#15110d";
const INK = "#ece3d3";
const INK_SUBTLE = "#948775";
const ACCENT = "#d65f57";
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'SF Mono', ui-monospace, Menlo, monospace";
const SIZE = { width: 1200, height: 630 };

function absolute(image: string | null | undefined): string | null {
  if (!image) return null;
  return image.startsWith("http") ? image : `${SITE_URL}${image}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const user = await findUserByHandle(handle);
  const name = user?.name ?? (user?.handle ? `@${user.handle}` : "Lesswhelmed");
  const at = user?.handle ? `@${user.handle}` : "";
  const avatar = absolute(user?.image);
  const initial = (user?.name ?? user?.handle ?? "S").trim().charAt(0).toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: "72px 80px",
          backgroundImage: `radial-gradient(ellipse 70% 60% at 10% 0%, rgba(214,95,87,0.12), transparent 60%)`,
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
          <span>You&#39;re invited to Lesswhelmed</span>
          <span style={{ color: ACCENT }}>iOS · Web</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              width={220}
              height={220}
              style={{ width: 220, height: 220, borderRadius: 110, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: 220,
                height: 220,
                borderRadius: 110,
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(236,227,211,0.06)",
                border: `2px solid ${INK_SUBTLE}`,
                fontFamily: SERIF,
                fontSize: 96,
                color: INK,
              }}
            >
              {initial}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
            <div style={{ display: "flex", fontFamily: SERIF, fontSize: 88, lineHeight: 1, letterSpacing: -2, color: INK }}>
              {name}
            </div>
            {at ? (
              <div style={{ display: "flex", marginTop: 12, fontFamily: MONO, fontSize: 28, color: ACCENT }}>
                {at}
              </div>
            ) : null}
            <div style={{ display: "flex", marginTop: 22, fontFamily: SERIF, fontSize: 34, lineHeight: 1.25, color: INK_SUBTLE }}>
              Add me on Lesswhelmed — my personal catalog of everything worth keeping.
            </div>
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
      </div>
    ),
    SIZE,
  );
}
