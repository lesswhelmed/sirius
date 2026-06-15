import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Field,
  KeyboardDoneButton,
  PageHeader,
  PrimaryButton,
  Screen,
  TextLink,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiDelete, apiGet, apiPatch, apiPostJson } from "@/lib/api";

// A focus area (Project) row, mirroring the web ProjectsBoard shape.
type FocusArea = {
  id: string;
  title: string;
  description: string | null;
  status: string;
};

const QUERY_KEY = ["focus-areas"] as const;

// Mirrors apps/web/app/(app)/projects/projects-board.tsx — create / list /
// archive (restore) / delete focus areas, with optimistic updates that revert
// on failure. Pushed Stack route, reachable from the composer.
export default function FocusScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () =>
      apiGet<{ items: FocusArea[] }>("/api/app/projects?limit=100"),
  });

  const items = data?.items ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const setItems = (next: (prev: FocusArea[]) => FocusArea[]) => {
    queryClient.setQueryData<{ items: FocusArea[] }>(QUERY_KEY, (prev) => ({
      items: next(prev?.items ?? []),
    }));
  };

  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setFormError(null);
    try {
      const trimmedDescription = description.trim();
      const { project } = await apiPostJson<{ project: FocusArea }>(
        "/api/app/projects",
        trimmedDescription
          ? { title: trimmed, description: trimmedDescription }
          : { title: trimmed }
      );
      setItems((prev) => [project, ...prev]);
      setTitle("");
      setDescription("");
    } catch {
      setFormError("Could not create focus area.");
    } finally {
      setCreating(false);
    }
  };

  // Snapshot the live cache (not the render-time `items`) so a revert can't
  // clobber a concurrent mutation's write.
  const snapshot = () =>
    queryClient.getQueryData<{ items: FocusArea[] }>(QUERY_KEY);
  const restore = (prev: { items: FocusArea[] } | undefined) => {
    queryClient.setQueryData(QUERY_KEY, prev ?? { items: [] });
  };

  const setStatus = async (id: string, status: string) => {
    const previous = snapshot();
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status } : p))
    );
    try {
      await apiPatch(`/api/app/projects/${id}`, { status });
    } catch {
      restore(previous);
    }
  };

  const remove = async (id: string) => {
    const previous = snapshot();
    setItems((prev) => prev.filter((p) => p.id !== id));
    try {
      await apiDelete(`/api/app/projects/${id}`);
    } catch {
      restore(previous);
    }
  };

  if (isLoading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Sirius.color.accent} />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Couldn’t load focus areas</Text>
        <Text style={styles.errorBody}>{(error as Error).message}</Text>
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <PageHeader
            eyebrow="Section IV — Focus"
            title="Focus Areas"
            titleAccent="."
            subtitle="Concrete projects you file captured work under. Group them beneath an aspiration, or keep them standalone."
          />

          <View style={styles.form}>
            <Field
              placeholder="New focus area — e.g. Launch Q4 campaign"
              value={title}
              onChangeText={setTitle}
              autoCapitalize="sentences"
              returnKeyType="next"
            />
            <Field
              placeholder="What is this focus area about? (optional)"
              value={description}
              onChangeText={setDescription}
              multiline
              style={styles.descriptionInput}
            />
            <KeyboardDoneButton style={styles.keyboardDone} />
            <PrimaryButton
              label="Add focus area"
              onPress={create}
              busy={creating}
              disabled={title.trim() === ""}
            />
            {formError ? (
              <Text style={styles.formError}>{formError}</Text>
            ) : null}
          </View>

          {items.length === 0 ? (
            <Text style={styles.empty}>No focus areas yet.</Text>
          ) : (
            <View style={styles.list}>
              {items.map((p) => (
                <View key={p.id} style={styles.row}>
                  <View style={styles.rowMain}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {p.title}
                      </Text>
                      {p.status === "archived" ? (
                        <Text style={styles.archivedTag}>Archived</Text>
                      ) : null}
                    </View>
                    {p.description ? (
                      <Text style={styles.rowDescription} numberOfLines={1}>
                        {p.description}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.rowActions}>
                    <TextLink
                      label={p.status === "archived" ? "Restore" : "Archive"}
                      tone={Sirius.color.inkMuted}
                      onPress={() =>
                        setStatus(
                          p.id,
                          p.status === "archived" ? "active" : "archived"
                        )
                      }
                    />
                    <TextLink
                      label="Delete"
                      tone={Sirius.color.inkSubtle}
                      onPress={() => remove(p.id)}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center" },
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  container: {
    paddingHorizontal: Sirius.space.xl,
    paddingTop: 64,
    paddingBottom: 120,
    gap: Sirius.space.xl,
  },
  form: { gap: Sirius.space.md },
  descriptionInput: { minHeight: 72, textAlignVertical: "top", paddingTop: 12 },
  // Sits right-aligned just above the full-width submit button.
  keyboardDone: { alignSelf: "flex-end" },
  formError: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: Sirius.color.accent,
  },
  empty: {
    fontFamily: Sirius.font.serif,
    fontSize: 17,
    fontStyle: "italic",
    color: Sirius.color.inkSubtle,
  },
  list: { gap: 0 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Sirius.space.lg,
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    paddingVertical: Sirius.space.lg,
  },
  rowMain: { flex: 1, gap: Sirius.space.xs },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Sirius.space.sm,
  },
  rowTitle: {
    flexShrink: 1,
    fontFamily: Sirius.font.serif,
    fontSize: 20,
    fontStyle: "italic",
    color: Sirius.color.ink,
  },
  archivedTag: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  rowDescription: {
    fontFamily: Sirius.font.serif,
    fontSize: 14,
    color: Sirius.color.inkMuted,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Sirius.space.lg,
    paddingTop: 4,
  },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
});
