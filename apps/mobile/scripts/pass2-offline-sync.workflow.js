// Pass-2 fan-out: validate the mobile offline-sync WIP (shipped to prod via OTA
// from commit f322e46) across independent test dimensions in parallel, then
// synthesize a go/rollback verdict.
//
// RUN IT (from a Claude Code session that has opted into orchestration):
//   Workflow({ scriptPath: "apps/mobile/scripts/pass2-offline-sync.workflow.js",
//              args: { surface: "sim" } })   // surface: "sim" (default) | "prod"
//
// "sim"  = iPhone 17 Pro dev client (bundle dev.copt.sirius → sirius.local). Fast
//          functional coverage of the SAME OTA JS, against the dev server.
// "prod" = a physical device on production build #17 (got the OTA) → lesswhelmed.com.
//          Requires the prod password — agents must ASK, not guess.
//
// Each dimension agent runs the agent-device / agent-browser CLIs itself (it has
// Bash). It returns a structured verdict; the synth agent rolls them up. No agent
// edits prod-shipped code or re-OTAs — findings become HANDOFFs + beads.
export const meta = {
	name: "pass2-offline-sync",
	description:
		"Parallel validation of the mobile offline-sync WIP + go/rollback verdict",
	phases: [
		{ title: "Test", detail: "one agent per independent test dimension" },
		{
			title: "Synthesize",
			detail: "roll up verdicts → rollback recommendation",
		},
	],
};

const surface = (args && args.surface) === "prod" ? "prod" : "sim";

const COMMON = `
Repo: /Users/minasaleeb/workspaces/sirius-2-simple (bun monorepo — read CLAUDE.md).
Under test: offline-sync WIP at apps/mobile/src/lib/{db,sync}/ shipped to prod via OTA
(iOS update group c67c3dff-af3b-4a71-845a-bbe10ac8616d, runtime a371f5d3… == build #17),
commit f322e46. See memory mobile-offline-first-sync for the architecture.
Tools you must drive yourself via Bash:
  • agent-device (v0.14.6) — run \`agent-device help workflow\` first. iOS sim "iPhone 17 Pro",
    dev-client bundle dev.copt.sirius. Physical devices (Meowinas / iPhone) are booted for prod.
  • agent-browser — run \`agent-browser skills get core\` first.
  • helper scripts: apps/mobile/scripts/test-tree-categories.sh, scripts/probe-embedding-scene.sh.
  • prod SSH (read-only): host+key in .env.production; pm2 sirius-worker; logs
    /home/deploy/logs/sirius-worker-{out,error}.log.
Creds: dev = saleebmina@icloud.com + DEV_LOGIN_PASSWORD (root .env). PROD is a SEPARATE realm
(same email, different password) — if a step needs prod login, STOP and report "needs prod password",
do not guess. Test surface for THIS run = ${surface}.
Rules: never edit prod-shipped code, commit, or re-OTA. Reproduce minimally; capture which surface
(sim/prod) each result came from with concrete evidence (snapshot/screenshot/log line). If you find a
real failure, write the root cause into a HANDOFF-<topic>.md at repo root and reference it in your verdict.
`;

// Independent dimensions — each is blind to the others (true fan-out).
const DIMENSIONS = [
	{
		key: "migration-safety",
		prompt: `Validate the on-device drizzle migration 0001_tense_the_hood.sql (ALTER TABLE posts
ADD provider_id + content_digest). Cover BOTH paths: (1) fresh install (no prior sirius.db),
(2) upgrade over a pre-0001 db. Cold-start the app twice each. Assert: no white-screen/crash from
<DbGate> migrations in _layout.tsx, the posts table ends with provider_id AND content_digest, and
no "duplicate column" error on re-run (idempotency). This is the #1 prod crash risk — be thorough.`,
	},
	{
		key: "offline-create-reconcile",
		prompt: `Validate offline create → reconcile. With the device offline (airplane mode), create a
text note in the composer; confirm it lands in pending_submissions and renders optimistically via
useLiveQuery. Relaunch, go online; assert the pending row REPLAYS (transport "ingest") and reconciles
into the SAME local row (stable localId, keyed by Post.sourceRecordId) flipping syncState→synced and
clearing draftEnvelopeJson — NOT a duplicate row. (Offline IMAGE drafts are deferred → expected to
mark failed; don't flag that as a bug.)`,
	},
	{
		key: "realtime-nudge",
		prompt: `Validate realtime push. Ingest a new note for the same owner from another client (web
composer, or POST via scripts/probe-embedding-scene.sh's host). Assert the SSE stream
/api/app/posts/stream nudges, the mobile pulls the delta /api/app/posts/changes (listPostsChangedSince),
and the new post appears LIVE in the library via useLiveQuery WITHOUT a manual refresh. Confirm SSE
carries a nudge, not the post body (Postgres NOTIFY 8KB cap).`,
	},
	{
		key: "owner-scoping",
		prompt: `Validate the local mirror is OWNER-SCOPED. Assert the SQLite posts table only contains rows
with submittedById == the signed-in user (not the global all-posts the old /api/app/posts returned).
Inspect via the app UI (library list) and, if reachable, the changes feed payload. Flag any leakage of
other users' posts into the local store.`,
	},
	{
		key: "no-regression",
		prompt: `Validate NO regression in the surfaces still on React Query (NOT SQLite): the Tree tab and
the Queue/server-list. Run apps/mobile/scripts/test-tree-categories.sh and assert the Tree category
outline renders (the shipped parentPath fix) and the Queue still loads. Confirm these did not get
accidentally wired to the local store.`,
	},
];

phase("Test");
const verdicts = await parallel(
	DIMENSIONS.map(
		(d) => () =>
			agent(`${COMMON}\nDIMENSION: ${d.key}\n${d.prompt}`, {
				label: `test:${d.key}`,
				phase: "Test",
				schema: {
					type: "object",
					additionalProperties: false,
					required: ["dimension", "surface", "passed", "severity", "evidence"],
					properties: {
						dimension: { type: "string" },
						surface: { type: "string", enum: ["sim", "prod", "blocked"] },
						passed: { type: "boolean" },
						severity: {
							type: "string",
							enum: ["none", "low", "medium", "high", "crash"],
						},
						evidence: {
							type: "string",
							description: "concrete: snapshot/screenshot path or log line",
						},
						rootCause: { type: "string" },
						handoff: {
							type: "string",
							description: "HANDOFF file path if one was written",
						},
					},
				},
			}).then((v) => ({
				...d,
				...(v || {
					dimension: d.key,
					surface: "blocked",
					passed: false,
					severity: "high",
					evidence: "agent returned null",
				}),
			})),
	),
);

phase("Synthesize");
const summary = await agent(
	`${COMMON}\nYou are the synthesis judge. Here are the Pass-2 dimension verdicts as JSON:\n` +
		JSON.stringify(verdicts, null, 2) +
		`\nProduce a crisp rollup: which dimensions passed, which failed (with severity), whether any
crash/high-severity issue warrants an immediate EAS rollback of the production OTA (iOS update group
c67c3dff-af3b-4a71-845a-bbe10ac8616d — rollback = republish the prior good group, ASK the owner first),
and the ordered next actions. Be decisive: rollback = yes only if a crash or data-loss/dup-row issue is
confirmed on a real device.`,
	{
		label: "synthesize:verdict",
		phase: "Synthesize",
		schema: {
			type: "object",
			additionalProperties: false,
			required: [
				"passedCount",
				"failedCount",
				"rollbackRecommended",
				"rollbackReason",
				"nextActions",
			],
			properties: {
				passedCount: { type: "number" },
				failedCount: { type: "number" },
				rollbackRecommended: { type: "boolean" },
				rollbackReason: { type: "string" },
				nextActions: { type: "array", items: { type: "string" } },
			},
		},
	},
);

log(
	`Pass-2 complete: ${summary?.passedCount ?? "?"} passed, ${summary?.failedCount ?? "?"} failed; rollback=${summary?.rollbackRecommended}`,
);
return { surface, verdicts, summary };
