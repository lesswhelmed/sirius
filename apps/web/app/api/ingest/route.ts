import { verifyBearer } from "../../../lib/ingest/auth";
import { submitUrlIngest } from "../../../lib/ingest/submit";

function jsonError(
	status: number,
	error: string,
	extra?: Record<string, unknown>,
) {
	return Response.json({ error, ...extra }, { status });
}

function log(
	level: "info" | "warn" | "error",
	msg: string,
	extra?: Record<string, unknown>,
) {
	const payload = extra ? ` ${JSON.stringify(extra)}` : "";
	console.log(`[ingest] [${level}] ${msg}${payload}`);
}

export async function POST(request: Request) {
	const auth = verifyBearer(request);
	if (!auth.ok) {
		log("warn", "unauthorized", { reason: auth.reason });
		return jsonError(401, "unauthorized", { reason: auth.reason });
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		log("warn", "invalid-json");
		return jsonError(400, "invalid JSON body");
	}

	const result = await submitUrlIngest(raw, log);
	if (!result.ok) {
		return jsonError(result.status, result.error, result.extra);
	}
	return Response.json(result.body, { status: result.status });
}
