// Session-gated archive request management.
//   POST /api/app/archive → enqueue a build of the user's data archive
//   GET  /api/app/archive → list the user's archive requests (settings history)
import { createArchiveRequest, listArchiveRequests } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

export async function POST() {
	const session = await getSessionOrNull();
	if (!session) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}
	const req = await createArchiveRequest(session.user.id);
	return Response.json({ id: req.id, status: req.status }, { status: 202 });
}

export async function GET() {
	const session = await getSessionOrNull();
	if (!session) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}
	const requests = await listArchiveRequests(session.user.id);
	return Response.json({ requests });
}
