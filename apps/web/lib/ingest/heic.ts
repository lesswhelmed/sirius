// HEIC/HEIF → JPEG conversion for the ingest hot-path.
//
// Why not sharp alone: the prebuilt libvips that ships with sharp on this stack
// can decode AVIF but NOT HEIC (HEVC) — `sharp(<iphone heic>)` throws "Support
// for this compression format has not been built in". So we decode HEIC with
// `heic-convert` (pure JS + wasm libheif, no native HEVC dependency, identical
// behavior on the Linux deploy host), then hand the decoded JPEG to sharp ONLY
// to downscale + re-encode (sharp reads JPEG fine). iPhone originals are ~3 MB
// at 4032px; we cap the long edge and mozjpeg-compress so served /sight/ images
// are reasonable.
import convert from "heic-convert";
import sharp from "sharp";

// Long-edge ceiling for served sight photos. 2560 keeps Retina-sharp full-bleed
// renders while cutting a 4032px iPhone original roughly in half.
const MAX_EDGE = 2560;
const JPEG_QUALITY = 82;

export const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

export function isHeicExtension(ext: string): boolean {
  return HEIC_EXTENSIONS.has(ext.toLowerCase());
}

// Decodes HEIC/HEIF bytes to an optimized JPEG. Throws on undecodable input —
// callers MUST treat a throw as a hard failure (do not stage the raw HEIC; an
// unservable .heic is the exact bug this exists to prevent). libheif applies the
// container's rotation during decode, so the JPEG is already upright; we strip
// any residual EXIF orientation via sharp's default normalization.
export async function heicToJpeg(bytes: Uint8Array): Promise<Buffer> {
  // heic-convert/heic-decode internally do `String.fromCharCode(...buf.slice())`,
  // so the input MUST be an iterable typed array (Uint8Array/Buffer) — a bare
  // ArrayBuffer throws "Spread syntax requires ...iterable". The @types declare
  // ArrayBufferLike, which is wrong, hence the cast. Buffer.from copies into a
  // zero-offset, exact-length view.
  const input = Buffer.from(bytes);
  const decoded = await convert({
    buffer: input as unknown as ArrayBufferLike,
    format: "JPEG",
    quality: JPEG_QUALITY / 100,
  });
  return sharp(Buffer.from(decoded))
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}
