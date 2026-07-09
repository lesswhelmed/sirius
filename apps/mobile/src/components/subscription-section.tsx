// "Sirius AI Pro" subscription surface for the Settings screen, plus a reusable
// UsageMeter. The weekly cap is enforced server-side; here we show the user
// where they stand and route them to the RevenueCat paywall / Customer Center.
import { useQueryClient } from "@tanstack/react-query";
import { openBrowserAsync } from "expo-web-browser";
import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton, SecondaryButton } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import {
  presentPaywall,
  useCustomerCenter,
  useEntitlement,
} from "@/lib/purchases";
import { PURCHASES_ENABLED } from "@/lib/purchases/config";
import { type AiUsage, useAiUsage } from "@/lib/purchases/use-usage";

// App Store Guideline 3.1.2(c): Privacy Policy + Terms of Use (EULA) must be
// visible in the subscription surface, independent of the RevenueCat paywall.
// Our /terms page carries the UGC zero-tolerance clause (Guideline 1.2) and
// itself references Apple's standard EULA, so 3.1.2(c) stays satisfied with a
// single link target everywhere (APP_STORE_SUBMISSION.md §0 decision 1).
const PRIVACY_URL = "https://lesswhelmed.com/privacy";
const TERMS_URL = "https://lesswhelmed.com/terms";

async function openLegal(url: string) {
  try {
    await openBrowserAsync(url);
  } catch {
    // A failed open shouldn't crash settings; ignore.
  }
}

function formatReset(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const d = new Date(resetsAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Compact weekly-budget readout. Safe to drop anywhere usage matters (settings,
// composer). Renders nothing until usage resolves.
export function UsageMeter({ usage }: { usage: AiUsage | undefined }) {
  const styles = useThemedStyles(makeStyles);
  if (!usage) return null;
  if (usage.isPro || usage.limit == null) {
    return (
      <Text style={styles.meterPro}>Sirius AI Pro — unlimited AI drafts</Text>
    );
  }
  const used = Math.min(usage.used, usage.limit);
  const pct = usage.limit > 0 ? used / usage.limit : 0;
  const reset = formatReset(usage.resetsAt);
  return (
    <View style={styles.meter}>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      <Text style={styles.meterText}>
        {usage.remaining ?? 0} of {usage.limit} free AI drafts left this week
        {reset ? ` · resets ${reset}` : ""}
      </Text>
    </View>
  );
}

export function SubscriptionSection() {
  const styles = useThemedStyles(makeStyles);
  const { isPro } = useEntitlement();
  const { data: usage } = useAiUsage();
  const { open: openCustomerCenter } = useCustomerCenter();
  const queryClient = useQueryClient();

  const refreshUsage = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
  }, [queryClient]);

  const onUpgrade = useCallback(async () => {
    const becamePro = await presentPaywall();
    if (becamePro) refreshUsage();
  }, [refreshUsage]);

  const showPro = isPro || usage?.isPro;
  // Bookmarks saved without an AI draft (over the weekly cap). Surfaced for
  // FREE users as upgrade context; Pro users regenerate any leftover stubs
  // from the post detail screen instead, so the Pro view stays unchanged.
  // `?? 0` tolerates an older cached payload without the field.
  const stubCount = usage?.stubCount ?? 0;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Subscription</Text>
      <View style={styles.card}>
        <Text style={styles.title}>
          {showPro ? "Sirius AI Pro" : "Free plan"}
        </Text>
        <UsageMeter usage={usage} />
        {!showPro && stubCount > 0 ? (
          <Text style={styles.stubLine}>
            {stubCount} post{stubCount === 1 ? "" : "s"} waiting for AI
          </Text>
        ) : null}
        {!showPro ? (
          <Text style={styles.sub}>
            Ingesting is always free. Upgrade for unlimited AI-drafted posts.
          </Text>
        ) : null}
      </View>
      {PURCHASES_ENABLED ? (
        <>
          {!showPro ? (
            <PrimaryButton label="Upgrade to Pro" onPress={onUpgrade} />
          ) : null}
          <SecondaryButton
            label="Manage subscription"
            symbol="creditcard"
            onPress={() => {
              void openCustomerCenter();
            }}
          />
        </>
      ) : null}
      <View style={styles.legal}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Privacy Policy"
          onPress={() => {
            void openLegal(PRIVACY_URL);
          }}
        >
          <Text style={styles.legalLink}>Privacy Policy</Text>
        </Pressable>
        <Text style={styles.legalDot}>·</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Terms of Use"
          onPress={() => {
            void openLegal(TERMS_URL);
          }}
        >
          <Text style={styles.legalLink}>Terms of Use</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    section: { gap: t.space.sm },
    sectionLabel: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    card: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.md,
      gap: t.space.sm,
    },
    title: {
      fontFamily: t.font.serif,
      fontSize: 17,
      color: t.color.ink,
    },
    sub: {
      fontFamily: t.font.sans,
      fontSize: 13,
      lineHeight: 18,
      color: t.color.inkMuted,
    },
    meter: { gap: t.space.xs },
    meterTrack: {
      height: 6,
      backgroundColor: t.color.rule,
      borderRadius: t.radius.none,
      overflow: "hidden",
    },
    meterFill: {
      height: "100%",
      backgroundColor: t.color.accent,
    },
    meterText: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkMuted,
    },
    meterPro: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.accent,
    },
    // "N posts waiting for AI" — sits directly under the meter, same register.
    stubLine: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkMuted,
    },
    legal: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.xs,
      paddingTop: t.space.xs,
    },
    legalLink: {
      fontFamily: t.font.sans,
      fontSize: 13,
      color: t.color.accent,
      textDecorationLine: "underline",
    },
    legalDot: {
      fontFamily: t.font.sans,
      fontSize: 13,
      color: t.color.inkSubtle,
    },
  });
}
