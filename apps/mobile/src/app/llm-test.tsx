// Dev-only draft test bench: exercises on-device post drafting end-to-end
// (lock → generateText → generateDraft → schema) against fixture notes, with
// deterministic quality checks — no composer, no submission, no server.
// Open via the /llm screen's dev link or deep link:
//   dev.copt.sirius://llm-test?run=all
import { useQuery } from "@tanstack/react-query";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  MetaText,
  PrimaryButton,
  Screen,
  StatusPip,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { canDraftOnDevice } from "@/lib/llm/curate";
import { ON_DEVICE_AI_ENABLED } from "@/lib/llm/flag";
import {
  ANSWER_QUALITY_FIXTURE,
  ASK_FLOW_FIXTURE,
  DRAFT_FIXTURES,
  type FixtureResult,
  GEN_DIAG_FIXTURE,
  runAnswerQualityTest,
  runAskFlowTest,
  runDraftFixture,
  runGenDiagnostic,
  runToolProbe,
  runTranscriptDraft,
  runUrlDraft,
  URL_EXTRACT_FIXTURE,
} from "@/lib/llm/test-bench";
import {
  canTranscribeOnDevice,
  prepareTranscription,
  transcribeAudio,
} from "@/lib/llm/transcribe";

const TOOL_PROBE_FIXTURE = {
  id: "toolprobe",
  label: "Tool-calling probe (Phase 0 spike)",
} as const;

export default function LlmTestScreen() {
  if (!__DEV__ || !ON_DEVICE_AI_ENABLED) {
    return (
      <Screen style={styles.centered}>
        <Text style={styles.dim}>Dev builds only.</Text>
      </Screen>
    );
  }
  // Hook rules are satisfied: __DEV__ and the on-device flag are both constant
  // for the life of the bundle.
  return <Bench />;
}

function Bench() {
  const params = useLocalSearchParams<{ run?: string }>();
  const ready = useQuery({
    queryKey: ["llm-draft-ready"],
    queryFn: canDraftOnDevice,
  });
  const [results, setResults] = useState<Record<string, FixtureResult>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const autoran = useRef(false);

  async function runOne(id: string) {
    const fixture = DRAFT_FIXTURES.find((f) => f.id === id);
    if (!fixture || runningId) {
      return;
    }
    setRunningId(id);
    try {
      const result = await runDraftFixture(fixture);
      setResults((prev) => ({ ...prev, [id]: result }));
    } finally {
      setRunningId(null);
    }
  }

  async function runUrl() {
    if (runningId) {
      return;
    }
    setRunningId(URL_EXTRACT_FIXTURE.id);
    try {
      const result = await runUrlDraft();
      setResults((prev) => ({ ...prev, [URL_EXTRACT_FIXTURE.id]: result }));
    } finally {
      setRunningId(null);
    }
  }

  async function runAskFlow() {
    if (runningId) {
      return;
    }
    setRunningId(ASK_FLOW_FIXTURE.id);
    try {
      const result = await runAskFlowTest();
      setResults((prev) => ({ ...prev, [ASK_FLOW_FIXTURE.id]: result }));
    } finally {
      setRunningId(null);
    }
  }

  async function runGenDiag() {
    if (runningId) {
      return;
    }
    setRunningId(GEN_DIAG_FIXTURE.id);
    try {
      const result = await runGenDiagnostic();
      setResults((prev) => ({ ...prev, [GEN_DIAG_FIXTURE.id]: result }));
    } finally {
      setRunningId(null);
    }
  }

  async function runAnswerQuality() {
    if (runningId) {
      return;
    }
    setRunningId(ANSWER_QUALITY_FIXTURE.id);
    try {
      const result = await runAnswerQualityTest();
      setResults((prev) => ({ ...prev, [ANSWER_QUALITY_FIXTURE.id]: result }));
    } finally {
      setRunningId(null);
    }
  }

  async function runToolProbeRun() {
    if (runningId) {
      return;
    }
    setRunningId(TOOL_PROBE_FIXTURE.id);
    const start = Date.now();
    try {
      await runToolProbe();
      const sentinel: FixtureResult = {
        id: TOOL_PROBE_FIXTURE.id,
        ok: true,
        ms: Date.now() - start,
        draft: null,
        checks: [],
      };
      setResults((prev) => ({ ...prev, [TOOL_PROBE_FIXTURE.id]: sentinel }));
    } catch {
      const sentinel: FixtureResult = {
        id: TOOL_PROBE_FIXTURE.id,
        ok: false,
        ms: Date.now() - start,
        draft: null,
        checks: [],
      };
      setResults((prev) => ({ ...prev, [TOOL_PROBE_FIXTURE.id]: sentinel }));
    } finally {
      setRunningId(null);
    }
  }

  async function runAll() {
    if (runningId) {
      return;
    }
    for (const fixture of DRAFT_FIXTURES) {
      setRunningId(fixture.id);
      try {
        const result = await runDraftFixture(fixture);
        setResults((prev) => ({ ...prev, [fixture.id]: result }));
      } finally {
        setRunningId(null);
      }
    }
    await runUrl();
    await runGenDiag();
    await runAnswerQuality();
    await runAskFlow();
    await runToolProbeRun();
    console.log("[llm-test] run-all-done");
  }

  // Deep-link autorun: dev.copt.sirius://llm-test?run=all (or one fixture id,
  // "search" for just the post-search bench — which only needs the embed model,
  // not the chat model the run-all gating waits on — or "ask" for the full
  // ask-my-posts chat flow: decide → search → grounded answer).
  useEffect(() => {
    if (!params.run || autoran.current) {
      return;
    }
    const run = params.run;
    // "ask" / "toolprobe" do their own model-readiness gating inside the runner
    // (isModelReady), so they don't wait on the canDraftOnDevice `ready` gate the
    // draft fixtures need.
    if (run === "ask") {
      autoran.current = true;
      const t = setTimeout(() => void runAskFlow(), 0);
      return () => clearTimeout(t);
    }
    if (run === "toolprobe") {
      autoran.current = true;
      const t = setTimeout(() => void runToolProbeRun(), 0);
      return () => clearTimeout(t);
    }
    if (run === "gen-diag") {
      autoran.current = true;
      const t = setTimeout(() => void runGenDiag(), 0);
      return () => clearTimeout(t);
    }
    if (run === "answer") {
      autoran.current = true;
      const t = setTimeout(() => void runAnswerQuality(), 0);
      return () => clearTimeout(t);
    }
    if (ready.data !== true) {
      return;
    }
    autoran.current = true;
    // Deferred so the kickoff's setState happens outside the effect body.
    const timer = setTimeout(() => {
      if (run === "all") {
        void runAll();
      } else {
        void runOne(run);
      }
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.run, ready.data]);

  const done = Object.values(results);
  const passed = done.filter((r) => r.ok).length;
  const avgMs =
    done.length > 0
      ? Math.round(done.reduce((sum, r) => sum + r.ms, 0) / done.length)
      : 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.list}>
        <MetaText style={styles.eyebrow}>Draft test bench</MetaText>
        {ready.data === false ? (
          <Text style={styles.warn}>
            Enable “Draft on device” and download a model first — the bench runs
            the same readiness checks as the composer.
          </Text>
        ) : null}
        <PrimaryButton
          label={runningId ? `Running ${runningId}…` : "Run all"}
          onPress={() => void runAll()}
          disabled={Boolean(runningId) || ready.data !== true}
        />
        {DRAFT_FIXTURES.map((fixture) => {
          const result = results[fixture.id];
          return (
            <Pressable
              key={fixture.id}
              style={styles.card}
              onPress={() =>
                setExpanded(expanded === fixture.id ? null : fixture.id)
              }
              onLongPress={() => void runOne(fixture.id)}
            >
              <View style={styles.cardHeader}>
                <StatusPip
                  label={
                    runningId === fixture.id
                      ? "running"
                      : result
                        ? result.ok
                          ? "pass"
                          : "fail"
                        : "idle"
                  }
                  color={
                    runningId === fixture.id
                      ? Sirius.color.accent
                      : result
                        ? result.ok
                          ? "#2c7a4b"
                          : "#a33"
                        : Sirius.color.inkSubtle
                  }
                />
                <Text style={styles.cardTitle}>{fixture.label}</Text>
                {result ? (
                  <Text style={styles.dim}>
                    {(result.ms / 1000).toFixed(1)}s
                  </Text>
                ) : null}
              </View>
              {result && !result.draft ? (
                <Text style={styles.warn}>
                  draft returned null — see the [llm] warn in Metro for why
                </Text>
              ) : null}
              {result?.checks.map((check) => (
                <Text
                  key={check.name}
                  style={check.pass ? styles.checkPass : styles.checkFail}
                >
                  {check.pass ? "✓" : "✗"} {check.name} — {check.detail}
                </Text>
              ))}
              {expanded === fixture.id && result?.draft ? (
                <Text style={styles.raw}>
                  {JSON.stringify(result.draft.post, null, 2)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        <Pressable
          style={styles.card}
          onPress={() =>
            setExpanded(
              expanded === URL_EXTRACT_FIXTURE.id
                ? null
                : URL_EXTRACT_FIXTURE.id,
            )
          }
          onLongPress={() => void runUrl()}
        >
          <View style={styles.cardHeader}>
            <StatusPip
              label={
                runningId === URL_EXTRACT_FIXTURE.id
                  ? "running"
                  : results[URL_EXTRACT_FIXTURE.id]
                    ? results[URL_EXTRACT_FIXTURE.id]!.ok
                      ? "pass"
                      : "fail"
                    : "idle"
              }
              color={
                runningId === URL_EXTRACT_FIXTURE.id
                  ? Sirius.color.accent
                  : results[URL_EXTRACT_FIXTURE.id]
                    ? results[URL_EXTRACT_FIXTURE.id]!.ok
                      ? "#2c7a4b"
                      : "#a33"
                    : Sirius.color.inkSubtle
              }
            />
            <Text style={styles.cardTitle}>{URL_EXTRACT_FIXTURE.label}</Text>
            {results[URL_EXTRACT_FIXTURE.id] ? (
              <Text style={styles.dim}>
                {(results[URL_EXTRACT_FIXTURE.id]!.ms / 1000).toFixed(1)}s
              </Text>
            ) : null}
          </View>
          {results[URL_EXTRACT_FIXTURE.id]?.checks.map((check) => (
            <Text
              key={check.name}
              style={check.pass ? styles.checkPass : styles.checkFail}
            >
              {check.pass ? "✓" : "✗"} {check.name} — {check.detail}
            </Text>
          ))}
          {expanded === URL_EXTRACT_FIXTURE.id &&
          results[URL_EXTRACT_FIXTURE.id]?.draft ? (
            <Text style={styles.raw}>
              {JSON.stringify(
                results[URL_EXTRACT_FIXTURE.id]!.draft!.post,
                null,
                2,
              )}
            </Text>
          ) : null}
        </Pressable>
        <MetaText style={styles.eyebrow}>Answers clearly about a post</MetaText>
        <PrimaryButton
          label={
            runningId === ANSWER_QUALITY_FIXTURE.id
              ? "Asking…"
              : "Run answer-quality test"
          }
          onPress={() => void runAnswerQuality()}
          disabled={Boolean(runningId)}
        />
        <Pressable
          style={styles.card}
          onLongPress={() => void runAnswerQuality()}
        >
          <View style={styles.cardHeader}>
            <StatusPip
              label={
                runningId === ANSWER_QUALITY_FIXTURE.id
                  ? "running"
                  : results[ANSWER_QUALITY_FIXTURE.id]
                    ? results[ANSWER_QUALITY_FIXTURE.id]!.ok
                      ? "pass"
                      : "fail"
                    : "idle"
              }
              color={
                runningId === ANSWER_QUALITY_FIXTURE.id
                  ? Sirius.color.accent
                  : results[ANSWER_QUALITY_FIXTURE.id]
                    ? results[ANSWER_QUALITY_FIXTURE.id]!.ok
                      ? "#2c7a4b"
                      : "#a33"
                    : Sirius.color.inkSubtle
              }
            />
            <Text style={styles.cardTitle}>
              {ANSWER_QUALITY_FIXTURE.label} — real askMyPosts answers
              substantively (not the 1-char regression) + cites the post
            </Text>
            {results[ANSWER_QUALITY_FIXTURE.id] ? (
              <Text style={styles.dim}>
                {(results[ANSWER_QUALITY_FIXTURE.id]!.ms / 1000).toFixed(1)}s
              </Text>
            ) : null}
          </View>
          {results[ANSWER_QUALITY_FIXTURE.id]?.checks.map((check) => (
            <Text
              key={check.name}
              style={check.pass ? styles.checkPass : styles.checkFail}
            >
              {check.pass ? "✓" : "✗"} {check.name} — {check.detail}
            </Text>
          ))}
        </Pressable>
        <MetaText style={styles.eyebrow}>
          Generation isn&apos;t truncated (n_predict)
        </MetaText>
        <PrimaryButton
          label={
            runningId === GEN_DIAG_FIXTURE.id
              ? "Running…"
              : "Run generation diagnostic"
          }
          onPress={() => void runGenDiag()}
          disabled={Boolean(runningId)}
        />
        <Pressable style={styles.card} onLongPress={() => void runGenDiag()}>
          <View style={styles.cardHeader}>
            <StatusPip
              label={
                runningId === GEN_DIAG_FIXTURE.id
                  ? "running"
                  : results[GEN_DIAG_FIXTURE.id]
                    ? results[GEN_DIAG_FIXTURE.id]!.ok
                      ? "pass"
                      : "fail"
                    : "idle"
              }
              color={
                runningId === GEN_DIAG_FIXTURE.id
                  ? Sirius.color.accent
                  : results[GEN_DIAG_FIXTURE.id]
                    ? results[GEN_DIAG_FIXTURE.id]!.ok
                      ? "#2c7a4b"
                      : "#a33"
                    : Sirius.color.inkSubtle
              }
            />
            <Text style={styles.cardTitle}>
              {GEN_DIAG_FIXTURE.label} — uncapped, then 1-token, then uncapped
              again (the last must stay full)
            </Text>
            {results[GEN_DIAG_FIXTURE.id] ? (
              <Text style={styles.dim}>
                {(results[GEN_DIAG_FIXTURE.id]!.ms / 1000).toFixed(1)}s
              </Text>
            ) : null}
          </View>
          {results[GEN_DIAG_FIXTURE.id]?.checks.map((check) => (
            <Text
              key={check.name}
              style={check.pass ? styles.checkPass : styles.checkFail}
            >
              {check.pass ? "✓" : "✗"} {check.name} — {check.detail}
            </Text>
          ))}
        </Pressable>
        <MetaText style={styles.eyebrow}>Ask my posts (full chat flow)</MetaText>
        <PrimaryButton
          label={
            runningId === ASK_FLOW_FIXTURE.id
              ? "Asking…"
              : "Run ask-my-posts flow"
          }
          onPress={() => void runAskFlow()}
          disabled={Boolean(runningId)}
        />
        <Pressable
          style={styles.card}
          onPress={() =>
            setExpanded(
              expanded === ASK_FLOW_FIXTURE.id ? null : ASK_FLOW_FIXTURE.id,
            )
          }
          onLongPress={() => void runAskFlow()}
        >
          <View style={styles.cardHeader}>
            <StatusPip
              label={
                runningId === ASK_FLOW_FIXTURE.id
                  ? "running"
                  : results[ASK_FLOW_FIXTURE.id]
                    ? results[ASK_FLOW_FIXTURE.id]!.ok
                      ? "pass"
                      : "fail"
                    : "idle"
              }
              color={
                runningId === ASK_FLOW_FIXTURE.id
                  ? Sirius.color.accent
                  : results[ASK_FLOW_FIXTURE.id]
                    ? results[ASK_FLOW_FIXTURE.id]!.ok
                      ? "#2c7a4b"
                      : "#a33"
                    : Sirius.color.inkSubtle
              }
            />
            <Text style={styles.cardTitle}>
              {ASK_FLOW_FIXTURE.label} — decide → search → grounded answer, the
              real chat path
            </Text>
            {results[ASK_FLOW_FIXTURE.id] ? (
              <Text style={styles.dim}>
                {(results[ASK_FLOW_FIXTURE.id]!.ms / 1000).toFixed(1)}s
              </Text>
            ) : null}
          </View>
          {results[ASK_FLOW_FIXTURE.id]?.checks.map((check) => (
            <Text
              key={check.name}
              style={check.pass ? styles.checkPass : styles.checkFail}
            >
              {check.pass ? "✓" : "✗"} {check.name} — {check.detail}
            </Text>
          ))}
        </Pressable>
        <MetaText style={styles.eyebrow}>
          Tool-calling probe (Phase 0 spike)
        </MetaText>
        <PrimaryButton
          label={
            runningId === TOOL_PROBE_FIXTURE.id
              ? "Probing…"
              : "Run tool-calling probe"
          }
          onPress={() => void runToolProbeRun()}
          disabled={Boolean(runningId)}
        />
        <Pressable
          style={styles.card}
          onLongPress={() => void runToolProbeRun()}
        >
          <View style={styles.cardHeader}>
            <StatusPip
              label={
                runningId === TOOL_PROBE_FIXTURE.id
                  ? "running"
                  : results[TOOL_PROBE_FIXTURE.id]
                    ? results[TOOL_PROBE_FIXTURE.id]!.ok
                      ? "pass"
                      : "fail"
                    : "idle"
              }
              color={
                runningId === TOOL_PROBE_FIXTURE.id
                  ? Sirius.color.accent
                  : results[TOOL_PROBE_FIXTURE.id]
                    ? results[TOOL_PROBE_FIXTURE.id]!.ok
                      ? "#2c7a4b"
                      : "#a33"
                    : Sirius.color.inkSubtle
              }
            />
            <Text style={styles.cardTitle}>
              {TOOL_PROBE_FIXTURE.label} — check Metro for{" "}
              {`{"id":"toolprobe-call","ok":...}`}
            </Text>
            {results[TOOL_PROBE_FIXTURE.id] ? (
              <Text style={styles.dim}>
                {(results[TOOL_PROBE_FIXTURE.id]!.ms / 1000).toFixed(1)}s
              </Text>
            ) : null}
          </View>
        </Pressable>
        {done.length > 0 ? (
          <Text style={styles.summary}>
            {passed}/{done.length} passed · avg {(avgMs / 1000).toFixed(1)}s ·
            long-press a card to rerun it
          </Text>
        ) : (
          <Text style={styles.dim}>
            Tap a card to expand its draft; long-press to run just that fixture.
          </Text>
        )}
        {Platform.OS === "ios" ? <AudioBench /> : null}
      </ScrollView>
    </Screen>
  );
}

// Apple-only: record → transcribeAudio → (optionally) draftNotePost, using
// the exact exports the production audio handler composes
// (materials.ts: canTranscribeOnDevice → transcribeAudio → draftNotePost).
function AudioBench() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [phase, setPhase] = useState<"transcribing" | "drafting" | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcribeMs, setTranscribeMs] = useState<number | null>(null);
  const [draftResult, setDraftResult] = useState<FixtureResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const available = useQuery({
    queryKey: ["llm-transcribe-available"],
    queryFn: canTranscribeOnDevice,
  });

  async function toggleRecording() {
    if (recording) {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      setRecording(false);
      const uri = recorder.uri;
      if (!uri) {
        setNote("recorder produced no file");
        return;
      }
      setPhase("transcribing");
      setTranscript(null);
      setDraftResult(null);
      const start = Date.now();
      try {
        const text = await transcribeAudio(uri);
        const ms = Date.now() - start;
        setTranscribeMs(ms);
        setTranscript(text);
        setNote(
          text === null
            ? "transcribeAudio returned null — see Metro [llm] warn"
            : null,
        );
        console.log(
          `[llm-test] ${JSON.stringify({
            id: "audio-transcribe",
            ok: text !== null && text.length > 0,
            ms,
            chars: text?.length ?? 0,
          })}`,
        );
      } finally {
        setPhase(null);
      }
      return;
    }
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      setNote("microphone permission denied");
      return;
    }
    // iOS blocks recording until the audio session opts into it; expo-audio
    // throws RecordingDisabledException without this (same as the composer).
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setNote(null);
    setRecording(true);
  }

  async function draftFromTranscript() {
    if (!transcript || phase) {
      return;
    }
    setPhase("drafting");
    try {
      setDraftResult(await runTranscriptDraft(transcript));
    } finally {
      setPhase(null);
    }
  }

  async function prepareAssets() {
    setNote(
      (await prepareTranscription())
        ? "language assets ready"
        : "prepare failed",
    );
    await available.refetch();
  }

  return (
    <View style={styles.audioSection}>
      <MetaText style={styles.eyebrow}>Audio transcription (Apple)</MetaText>
      <View style={styles.cardHeader}>
        <StatusPip
          label={
            available.data === undefined
              ? "checking"
              : available.data
                ? "available"
                : "unavailable"
          }
          color={
            available.data
              ? "#2c7a4b"
              : available.data === false
                ? "#a33"
                : Sirius.color.inkSubtle
          }
        />
        <Text style={styles.dim}>
          SpeechAnalyzer · iOS 26+ · runs entirely on this device
        </Text>
      </View>
      {available.data === false ? (
        <PrimaryButton
          label="Prepare language assets"
          onPress={() => void prepareAssets()}
        />
      ) : null}
      <PrimaryButton
        label={
          recording
            ? "Stop & transcribe"
            : phase === "transcribing"
              ? "Transcribing…"
              : "Record"
        }
        onPress={() => void toggleRecording()}
        disabled={Boolean(phase) || available.data !== true}
      />
      {note ? <Text style={styles.warn}>{note}</Text> : null}
      {transcript !== null ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <StatusPip
              label={transcript.length > 0 ? "transcribed" : "empty"}
              color={transcript.length > 0 ? "#2c7a4b" : "#a33"}
            />
            <Text style={styles.dim}>
              {transcribeMs !== null
                ? `${(transcribeMs / 1000).toFixed(1)}s`
                : ""}
              {" · "}
              {transcript.length} chars
            </Text>
          </View>
          <Text style={styles.raw}>{transcript || "(empty transcript)"}</Text>
          <PrimaryButton
            label={
              phase === "drafting" ? "Drafting…" : "Draft from transcript →"
            }
            onPress={() => void draftFromTranscript()}
            disabled={Boolean(phase) || transcript.length === 0}
          />
          {draftResult?.checks.map((check) => (
            <Text
              key={check.name}
              style={check.pass ? styles.checkPass : styles.checkFail}
            >
              {check.pass ? "✓" : "✗"} {check.name} — {check.detail}
            </Text>
          ))}
          {draftResult?.draft ? (
            <Text style={styles.raw}>
              {JSON.stringify(draftResult.draft.post, null, 2)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  list: {
    gap: Sirius.space.md,
    paddingBottom: 80,
    paddingHorizontal: Sirius.space.xl,
    paddingTop: Sirius.space.xl,
  },
  eyebrow: { marginBottom: Sirius.space.xs },
  card: {
    backgroundColor: Sirius.color.paperRaised,
    borderRadius: 8,
    gap: Sirius.space.xs,
    padding: Sirius.space.md,
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Sirius.space.sm,
  },
  cardTitle: {
    color: Sirius.color.ink,
    flex: 1,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
  },
  checkPass: { color: "#2c7a4b", fontSize: 12 },
  checkFail: { color: "#a33", fontSize: 12 },
  raw: {
    color: Sirius.color.inkMuted,
    fontFamily: "Menlo",
    fontSize: 11,
    marginTop: Sirius.space.xs,
  },
  summary: { color: Sirius.color.inkMuted, fontSize: 13 },
  audioSection: {
    borderTopColor: Sirius.color.rule,
    borderTopWidth: 1,
    gap: Sirius.space.md,
    marginTop: Sirius.space.lg,
    paddingTop: Sirius.space.lg,
  },
  warn: { color: "#a33", fontSize: 13 },
  dim: { color: Sirius.color.inkSubtle, fontSize: 13 },
});
