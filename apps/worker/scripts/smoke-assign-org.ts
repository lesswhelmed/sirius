// E2E smoke for the auto-org stage. Creates a throwaway user + two unscoped
// "note" ingests with similar content, runs them through assignOrg, and asserts:
//   1. the first auto-CREATES an Aspiration + Project and files the post under it
//   2. the second REUSES that same Project (similar content matches)
// Then deletes everything it created. Mutates the DB but cleans up after itself.
//
// Prereq: GEMINI_API_KEY + DATABASE_URL. The taxonomy is grown from user content
// (dynamic topics/*); this smoke exercises auto-org against the user's own data.
// Usage (from repo root so root .env loads):
//   bun apps/worker/scripts/smoke-assign-org.ts
import { prisma } from "@repo/db";
import { buildClassificationInput } from "../src/pipeline/classification/adapters";
import { assignOrg } from "../src/pipeline/classification/assign-org";
import type { GeminiOutput, PipelineInput } from "../src/pipeline/types";

function noteDraft(
	title: string,
	body: string,
	tags: string[],
	categories: string[],
): GeminiOutput {
	return {
		slug: "",
		title,
		type: "BLOG",
		body,
		frontmatter: { tags, categories },
		rawMdx: "",
	};
}

async function runOne(
	ownerId: string,
	text: string,
	draft: GeminiOutput,
): Promise<{ projectId: string; created: boolean }> {
	const submission = await prisma.ingestSubmission.create({
		data: {
			kind: "note",
			payload: { notes: text },
			contentHash: `smoke-${crypto.randomUUID()}`,
			status: "completed",
			submittedById: ownerId,
		},
	});
	const post = await prisma.post.create({
		data: {
			slug: `smoke-${crypto.randomUUID()}`,
			title: draft.title,
			content: draft.body,
			type: "BLOG",
			filePath: `db://smoke/${submission.id}`,
			fileHash: crypto.randomUUID(),
			submittedById: ownerId,
		},
	});
	const input: PipelineInput = {
		kind: "note",
		submission,
		notes: text,
		submittedById: ownerId,
		projectId: null,
	};
	const classificationInput = buildClassificationInput(input, draft);
	const org = await assignOrg({ input, postId: post.id, classificationInput });
	if (!org) {
		throw new Error("assignOrg returned null (expected a result)");
	}
	if (!org.project) {
		throw new Error("assignOrg did not assign a project (expected one)");
	}
	// verify the post + submission were actually updated
	const refreshed = await prisma.post.findUnique({ where: { id: post.id } });
	if (refreshed?.projectId !== org.project.projectId) {
		throw new Error(
			`post.projectId (${refreshed?.projectId}) != org.project.projectId (${org.project.projectId})`,
		);
	}
	const sub = await prisma.ingestSubmission.findUnique({
		where: { id: submission.id },
	});
	if (sub?.projectId !== org.project.projectId) {
		throw new Error(`submission.projectId (${sub?.projectId}) not backfilled`);
	}
	return org.project;
}

async function main(): Promise<void> {
	const user = await prisma.user.create({
		data: {
			name: "Auto-Org Smoke",
			email: `auto-org-smoke+${crypto.randomUUID()}@example.test`,
			emailVerified: true,
		},
	});
	console.log(`temp user: ${user.id}`);

	try {
		const first = await runOne(
			user.id,
			"Pulled my first espresso shot on the new machine — 18g in, 36g out, around 28 seconds.",
			noteDraft(
				"First Espresso Pull",
				"Notes from pulling a first espresso shot on a new machine: 18g dose, 36g yield, ~28 second extraction.",
				["espresso", "coffee", "brewing"],
				["coffee", "brewing"],
			),
		);
		console.log(
			`first  -> project ${first.projectId} created=${first.created}`,
		);
		if (!first.created) {
			throw new Error("FAIL: first ingest should have auto-created a project");
		}

		const second = await runOne(
			user.id,
			"Dialed in the grinder for the same espresso setup — finer grind gave better crema and flow.",
			noteDraft(
				"Dialing In the Grinder",
				"Adjusting the grinder for the same espresso setup: a finer grind improved crema and slowed the flow into the right range.",
				["espresso", "grinder", "coffee"],
				["coffee", "brewing"],
			),
		);
		console.log(
			`second -> project ${second.projectId} created=${second.created}`,
		);
		if (second.created) {
			throw new Error(
				"FAIL: second similar ingest should have REUSED the first project",
			);
		}
		if (second.projectId !== first.projectId) {
			throw new Error(
				"FAIL: second ingest matched a different project than the first",
			);
		}

		console.log("PASS: auto-create then reuse works");
	} finally {
		// Cleanup everything owned by the temp user (order respects FKs).
		await prisma.post.deleteMany({ where: { submittedById: user.id } });
		await prisma.ingestSubmission.deleteMany({
			where: { submittedById: user.id },
		});
		await prisma.projectEmbedding.deleteMany({ where: { ownerId: user.id } });
		await prisma.project.deleteMany({ where: { ownerId: user.id } });
		await prisma.aspiration.deleteMany({ where: { ownerId: user.id } });
		await prisma.user.delete({ where: { id: user.id } });
		console.log("cleaned up temp data");
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("[smoke-assign-org] failed:", err);
		process.exit(1);
	});
