// Thin shared UI primitives for the Sirius editorial mobile theme. These keep
// the paper-and-ink language (see constants/theme.ts) consistent across
// screens without pulling in a styling library. Everything is built on plain
// react-native + StyleSheet.create per the project's RN conventions.
import { SymbolView } from "expo-symbols";
import { forwardRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";

import { Sirius } from "@/constants/theme";

// Full-bleed paper background. Screens layer their own padding on top.
export function Screen({ style, ...rest }: ViewProps) {
  return <View style={[styles.screen, style]} {...rest} />;
}

// Mono uppercase eyebrow/folio label — the recurring "Section II — Catalogue"
// motif from the web header.
export function Eyebrow({ style, ...rest }: TextProps) {
  return <Text style={[styles.eyebrow, style]} {...rest} />;
}

// Large editorial serif title. `accent` renders a trailing oxblood glyph
// (comma/period) like the web headings.
export function Title({
  children,
  accent,
  style,
  ...rest
}: TextProps & { accent?: string }) {
  return (
    <Text style={[styles.title, style]} {...rest}>
      {children}
      {accent ? <Text style={styles.titleAccent}>{accent}</Text> : null}
    </Text>
  );
}

export function PageHeader({
  eyebrow,
  title,
  titleAccent,
  subtitle,
  count,
  countLabel,
}: {
  eyebrow?: string;
  title: string;
  titleAccent?: string;
  subtitle?: string;
  count?: number | string;
  countLabel?: string;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerMain}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Title accent={titleAccent}>{title}</Title>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {count !== undefined ? (
        <View style={styles.headerCount}>
          <Text style={styles.countValue}>{count}</Text>
          {countLabel ? (
            <Text style={styles.countLabel}>{countLabel}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// Secondary / metadata text in muted ink.
export function MetaText({ style, ...rest }: TextProps) {
  return <Text style={[styles.meta, style]} {...rest} />;
}

// Mono uppercase tag, e.g. a post kind. `tone` overrides the color.
export function KindLabel({
  tone,
  style,
  ...rest
}: TextProps & { tone?: string }) {
  return (
    <Text style={[styles.kind, tone ? { color: tone } : null, style]} {...rest} />
  );
}

// A small colored dot + uppercase status label, mirroring the web StatusPip.
export function StatusPip({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <View style={styles.pipRow}>
      <View style={[styles.pipDot, { backgroundColor: color }]} />
      <Text style={styles.pipLabel}>{label}</Text>
    </View>
  );
}

const Field = forwardRef<TextInput, TextInputProps & { label?: string }>(
  function Field({ label, style, ...rest }, ref) {
    return (
      <View style={styles.field}>
        {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
        <TextInput
          ref={ref}
          style={[styles.input, style]}
          placeholderTextColor={Sirius.color.inkSubtle}
          selectionColor={Sirius.color.accent}
          {...rest}
        />
      </View>
    );
  }
);

export { Field };

type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({
  label,
  busy,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled || busy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.primaryButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.primaryButtonPressed,
        style,
      ]}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator color={Sirius.color.onAccent} />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  busy,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled || busy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.secondaryButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.secondaryButtonPressed,
        style,
      ]}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator color={Sirius.color.accent} />
      ) : (
        <Text style={styles.secondaryButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

// A bordered text link/button used in footers ("Sign out", "Create account").
export function TextLink({
  label,
  tone = Sirius.color.accent,
  ...rest
}: Omit<PressableProps, "children"> & { label: string; tone?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={12}
      style={({ pressed }) => [pressed && styles.linkPressed]}
      {...rest}
    >
      <Text style={[styles.link, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

// A square tappable card for the composer's capture grid: an SF-symbol icon
// over a label, flat and ruled like the rest of the editorial chrome. `glyph`
// is the Android/web text fallback for the symbol. `active` highlights the card
// whose input sheet is currently open.
export function ActionCard({
  label,
  symbol,
  glyph,
  active,
  style,
  accessibilityHint,
  ...rest
}: Omit<PressableProps, "children" | "style"> & {
  label: string;
  symbol: SFSymbol;
  glyph: string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.actionCard,
        active && styles.actionCardActive,
        pressed && styles.actionCardPressed,
        style,
      ]}
      {...rest}
    >
      <SymbolView
        name={symbol}
        size={26}
        weight="regular"
        tintColor={active ? Sirius.color.accent : Sirius.color.ink}
        fallback={
          <Text
            style={[
              styles.actionGlyph,
              active && { color: Sirius.color.accent },
            ]}
            accessibilityElementsHidden
          >
            {glyph}
          </Text>
        }
      />
      <Text style={[styles.actionLabel, active && styles.actionLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

// A bottom modal sheet that hosts a single capture kind's input form. Tapping
// the scrim or the OS back gesture dismisses it.
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          style={styles.sheetScrim}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {title ? (
            <Eyebrow accessibilityRole="header" style={styles.sheetTitle}>
              {title}
            </Eyebrow>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// One staged item in the composer/share tray: a mono kind tag, a one-line
// description, an optional leading thumbnail, and a remove control.
export function TrayRow({
  tag,
  description,
  onRemove,
  removeLabel,
  leading,
}: {
  tag: string;
  description: string;
  onRemove?: () => void;
  removeLabel?: string;
  leading?: ReactNode;
}) {
  return (
    <View style={styles.trayRow}>
      {leading}
      <View style={styles.trayText}>
        <KindLabel tone={Sirius.color.accent}>{tag}</KindLabel>
        <Text style={styles.trayDescription} numberOfLines={2}>
          {description}
        </Text>
      </View>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? "Remove item"}
          style={({ pressed }) => [
            styles.trayRemove,
            pressed && styles.linkPressed,
          ]}
        >
          <Text style={styles.trayRemoveText}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Sirius.color.paper },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: Sirius.space.lg,
  },
  headerMain: { flex: 1, gap: Sirius.space.xs },
  eyebrow: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  title: {
    fontFamily: Sirius.font.serif,
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: -0.5,
    color: Sirius.color.ink,
  },
  titleAccent: { color: Sirius.color.accent },
  subtitle: {
    marginTop: Sirius.space.sm,
    fontFamily: Sirius.font.serif,
    fontSize: 17,
    lineHeight: 23,
    color: Sirius.color.inkMuted,
  },
  headerCount: { alignItems: "flex-end" },
  countValue: {
    fontFamily: Sirius.font.serif,
    fontSize: 34,
    lineHeight: 36,
    color: Sirius.color.accent,
  },
  countLabel: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  meta: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.inkMuted,
  },
  kind: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  pipRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  pipDot: { width: 7, height: 7, borderRadius: Sirius.radius.pill },
  pipLabel: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  field: { gap: 6 },
  fieldLabel: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: Sirius.color.ruleStrong,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperRaised,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: Sirius.color.ink,
    minHeight: 48,
  },
  primaryButton: {
    backgroundColor: Sirius.color.accent,
    borderRadius: Sirius.radius.none,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  primaryButtonPressed: { backgroundColor: Sirius.color.accentDeep },
  primaryButtonText: {
    color: Sirius.color.onAccent,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Sirius.color.accent,
    borderRadius: Sirius.radius.none,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryButtonPressed: { backgroundColor: Sirius.color.accentSoft },
  secondaryButtonText: {
    color: Sirius.color.accent,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  buttonDisabled: { opacity: 0.45 },
  link: { fontSize: 15, fontWeight: "600" },
  linkPressed: { opacity: 0.6 },
  actionCard: {
    flex: 1,
    minHeight: 104,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperRaised,
    alignItems: "center",
    justifyContent: "center",
    gap: Sirius.space.sm,
    paddingVertical: Sirius.space.lg,
  },
  actionCardActive: {
    borderColor: Sirius.color.accent,
    backgroundColor: Sirius.color.accentSoft,
  },
  actionCardPressed: { backgroundColor: Sirius.color.paperSunken },
  actionGlyph: {
    fontSize: 26,
    lineHeight: 30,
    color: Sirius.color.ink,
    fontFamily: Sirius.font.serif,
  },
  actionLabel: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  actionLabelActive: { color: Sirius.color.accent },
  sheetScrim: {
    flex: 1,
    backgroundColor: "rgba(28,22,18,0.4)",
  },
  sheet: {
    backgroundColor: Sirius.color.paper,
    borderTopWidth: 1,
    borderColor: Sirius.color.ruleStrong,
    paddingHorizontal: Sirius.space.xl,
    paddingTop: Sirius.space.md,
    paddingBottom: Sirius.space.xxl,
    gap: Sirius.space.lg,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: Sirius.radius.pill,
    backgroundColor: Sirius.color.inkFaint,
  },
  sheetTitle: { marginTop: Sirius.space.xs },
  trayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.md,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperRaised,
    paddingVertical: Sirius.space.sm,
    paddingHorizontal: Sirius.space.md,
  },
  trayText: { flex: 1, gap: 3 },
  trayDescription: {
    fontSize: 15,
    fontWeight: "500",
    color: Sirius.color.ink,
    fontFamily: Sirius.font.serif,
  },
  trayRemove: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  trayRemoveText: {
    fontSize: 22,
    lineHeight: 24,
    color: Sirius.color.inkMuted,
    fontWeight: "600",
  },
});
