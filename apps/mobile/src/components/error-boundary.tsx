// Root error boundary + a next-launch crash surface. Both are intentionally
// dependency-light (plain RN primitives, no theme context, no data layer): the
// thing they report on might BE the theme/provider/data layer failing, so they
// must render even when the rest of the app can't. See `@/lib/crash-log` for
// why the native crash report alone doesn't show the real error.
import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  clearLastCrash,
  type CrashRecord,
  readLastCrash,
  recordCrash,
} from "@/lib/crash-log";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

// Catches render/commit-phase errors React would otherwise turn into a fatal
// (white screen → expo-updates ErrorRecovery → SIGABRT). Records the error so
// it's reportable, and shows a legible, copyable fallback instead of crashing.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    recordCrash("render", error, {
      componentStack: info?.componentStack ?? undefined,
    });
  }

  private reset = () => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.fill}>
        <ScrollView contentContainerStyle={styles.pad}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app hit an error and stopped this screen from rendering. If you
            can, screenshot the details below and send them to us — it tells us
            exactly what failed.
          </Text>
          <Text selectable style={styles.errName}>
            {error.name}: {error.message}
          </Text>
          {error.stack ? (
            <Text selectable style={styles.stack}>
              {error.stack}
            </Text>
          ) : null}
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonLabel}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

// Renders nothing unless a crash was persisted on a PREVIOUS launch — then a
// dismissible bar appears so a tester can read/report what happened even
// without device logs. Tapping shows the full details; dismissing clears it.
// DEV-ONLY surface: raw stacks must never face production users, so outside
// __DEV__ this renders nothing — but the record stays on disk (not cleared)
// for a future diagnostics screen. Capture itself stays armed in prod.
export function LastCrashBanner(): React.ReactElement | null {
  const [crash, setCrash] = React.useState<CrashRecord | null>(null);

  React.useEffect(() => {
    if (!__DEV__) return;
    let cancelled = false;
    void readLastCrash().then((c) => {
      if (!cancelled) setCrash(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!crash) return null;

  const show = () => {
    Alert.alert(
      `Last crash · ${crash.source}${crash.isFatal ? " · fatal" : ""}`,
      `${crash.name ?? "Error"}: ${crash.message}\n\n${(
        crash.stack ??
        crash.componentStack ??
        ""
      ).slice(0, 1200)}`,
      [
        { text: "Close" },
        {
          text: "Dismiss & clear",
          style: "destructive",
          onPress: () => {
            void clearLastCrash();
            setCrash(null);
          },
        },
      ],
    );
  };

  return (
    <Pressable style={styles.banner} onPress={show}>
      <Text style={styles.bannerText} numberOfLines={1}>
        ⚠︎ The app closed unexpectedly last time — tap for details
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#131923" },
  pad: { padding: 24, paddingTop: 80, gap: 16 },
  title: { color: "#F4EFE6", fontSize: 22, fontWeight: "600" },
  body: { color: "#B9C0CC", fontSize: 15, lineHeight: 22 },
  errName: { color: "#FF8A80", fontSize: 14, fontWeight: "600" },
  stack: {
    color: "#8A93A3",
    fontSize: 12,
    fontFamily: "JetBrainsMono",
    lineHeight: 17,
  },
  button: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: "#F4EFE6",
  },
  buttonLabel: { color: "#131923", fontWeight: "600" },
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingTop: 56,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: "#7A1F1F",
  },
  bannerText: { color: "#FFE9E6", fontSize: 13, fontWeight: "600" },
});
