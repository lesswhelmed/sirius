// Magic-byte image format detection. Clients (iOS Shortcuts, curl --data-binary,
// some share sheets) frequently omit or generalize the Content-Type — sending
// application/octet-stream or image/heic-sequence — so we cannot trust the
// header alone to decide HEIC conversion or to reject unservable uploads. We
// sniff the actual bytes and treat that as authoritative when the header maps to
// nothing useful.

// HEIC/HEIF ISO-BMFF brands (incl. image-sequence / Live Photo container brands).
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heif",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

export type SniffedImage = { ext: string; contentType: string };

// Returns the real format of an image from its leading bytes, or null when the
// bytes don't match a raster format we can serve. Recognizes the formats the
// ingest pipeline serves directly plus HEIC/HEIF (which the caller transcodes).
export function sniffImageFormat(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  // PNG: 89 50 4E 47
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { ext: "png", contentType: "image/png" };
  }
  // GIF: 47 49 46 38 ("GIF8")
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { ext: "gif", contentType: "image/gif" };
  }
  // RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  // ISO-BMFF: bytes 4-8 = "ftyp", major brand at 8-12.
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(
      bytes[8]!,
      bytes[9]!,
      bytes[10]!,
      bytes[11]!,
    ).toLowerCase();
    if (HEIC_BRANDS.has(brand)) {
      return { ext: "heic", contentType: "image/heic" };
    }
    if (brand === "avif" || brand === "avis") {
      return { ext: "avif", contentType: "image/avif" };
    }
  }
  return null;
}
