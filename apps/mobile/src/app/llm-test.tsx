// Dev-only draft test bench: exercises on-device post drafting end-to-end
// (lock → generateObject → repairText → schema) against fixture notes, with
// deterministic quality checks — no composer, no submission, no server.
// Open via the /llm screen's dev link or deep link:
//   dev.copt.sirius://llm-test?run=all
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MetaText, PrimaryButton, Screen, StatusPip } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { canDraftOnDevice } from "@/lib/llm/curate";
import {
  DRAFT_FIXTURES,
  runDraftFixture,
  type FixtureResult,
} from "@/lib/llm/test-bench";

export default function LlmTestScreen() {
  if (!__DEV__) {
    return (
      <Screen style={styles.centered}>
        <Text style={styles.dim}>Dev builds only.</Text>
      </Screen>
    );
  }
  // Hook rules are satisfied: __DEV__ is constant for the life of the bundle.
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
    console.log("[llm-test] run-all-done");
  }

  // Deep-link autorun: dev.copt.sirius://llm-test?run=all (or one fixture id).
  useEffect(() => {
    if (!params.run || autoran.current || ready.data !== true) {
      return;
    }
    autoran.current = true;
    const run = params.run;
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
            Enable “Draft on device” and download a model first — the bench
            runs the same readiness checks as the composer.
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
                  <Text style={styles.dim}>{(result.ms / 1000).toFixed(1)}s</Text>
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
        {done.length > 0 ? (
          <Text style={styles.summary}>
            {passed}/{done.length} passed · avg{" "}
            {(avgMs / 1000).toFixed(1)}s · long-press a card to rerun it
          </Text>
        ) : (
          <Text style={styles.dim}>
            Tap a card to expand its draft; long-press to run just that
            fixture.
          </Text>
        )}
      </ScrollView>
    </Screen>
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
  warn: { color: "#a33", fontSize: 13 },
  dim: { color: Sirius.color.inkSubtle, fontSize: 13 },
});
