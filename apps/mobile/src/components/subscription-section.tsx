// "Sirius AI Pro" subscription surface for the Settings screen, plus a reusable
// UsageMeter. The weekly cap is enforced server-side; here we show the user
// where they stand and route them to the RevenueCat paywall / Customer Center.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";

import { PrimaryButton, SecondaryButton } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import {
  presentPaywall,
  useCustomerCenter,
  useEntitlement,
} from "@/lib/purchases";
import { PURCHASES_ENABLED } from "@/lib/purchases/config";
import { type AiUsage, useAiUsage } from "@/lib/purchases/use-usage";

function formatReset(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const d = new Date(resetsAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Compact weekly-budget readout. Safe to drop anywhere usage matters (settings,
// composer). Renders nothing until usage resolves.
export function UsageMeter({ usage }: { usage: AiUsage | undefined }) {
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

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Subscription</Text>
      <View style={styles.card}>
        <Text style={styles.title}>
          {showPro ? "Sirius AI Pro" : "Free plan"}
        </Text>
        <UsageMeter usage={usage} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Sirius.space.sm },
  sectionLabel: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  card: {
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperRaised,
    paddingHorizontal: Sirius.space.lg,
    paddingVertical: Sirius.space.md,
    gap: Sirius.space.sm,
  },
  title: {
    fontFamily: Sirius.font.serif,
    fontSize: 17,
    color: Sirius.color.ink,
  },
  sub: {
    fontFamily: Sirius.font.sans,
    fontSize: 13,
    lineHeight: 18,
    color: Sirius.color.inkMuted,
  },
  meter: { gap: Sirius.space.xs },
  meterTrack: {
    height: 6,
    backgroundColor: Sirius.color.rule,
    borderRadius: Sirius.radius.none,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    backgroundColor: Sirius.color.accent,
  },
  meterText: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    color: Sirius.color.inkMuted,
  },
  meterPro: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.accent,
  },
});
