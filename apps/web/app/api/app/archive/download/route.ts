// Token-gated archive download. Reached from the emailed link, so it is NOT
// session-gated — instead it validates the random per-archive token (24 bytes,
// non-enumerable) and its expiry. Scoped to exactly that archive's zip.
//   GET /api/app/archive/download?token=...
import { findArchiveByToken, markArchiveExpired } from "@repo/db";
import { resolveArchivesDir } from "../../../../../lib/originals/originals-paths";
import { serveOriginal } from "../../../../../lib/originals/serve-original";

export async function GET(request: Request) {
	const token = new URL(request.url).searchParams.get("token");
	if (!token) {
		return Response.json({ error: "missing-token" }, { status: 400 });
	}
	const archive = await findArchiveByToken(token);
	if (!archive || archive.status !== "ready" || !archive.downloadPath) {
		return Response.json({ error: "not-found" }, { status: 404 });
	}
	if (archive.expiresAt && archive.expiresAt.getTime() < Date.now()) {
		await markArchiveExpired(archive.id);
		return new Response("This archive link has expired.", {
			status: 410,
			headers: { "content-type": "text/plain" },
		});
	}
	const date = archive.completedAt ?? archive.createdAt;
	const stamp = date.toISOString().slice(0, 10);
	return serveOriginal({
		baseDir: resolveArchivesDir(),
		absolutePath: archive.downloadPath,
		downloadName: `sirius-archive-${stamp}.zip`,
		contentType: "application/zip",
	});
}
