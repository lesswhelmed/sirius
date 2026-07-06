// Thin shared UI primitives for the Sirius editorial mobile theme. These keep
// the paper-and-ink language (see constants/theme.ts) consistent across
// screens without pulling in a styling library. Everything is built on plain
// react-native + StyleSheet.create per the project's RN conventions.
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  type PressableProps,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import type { SFSymbol } from "sf-symbols-typescript";

import { BottomTabInset, MaxContentWidth, type Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { useReducedMotion } from "@/lib/a11y";
import type { UnifiedStatus, UnifiedView } from "@/lib/ingest-status";
import { getProgress, subscribe } from "@/lib/upload-progress";

// A multiline TextInput grows with its content. Left uncapped it eventually
// fills (and overruns) the screen, shoving the action buttons behind the
// keyboard with no way back. Cap it at ~40% of the window so it scrolls
// internally instead, keeping the surrounding controls reachable.
const MULTILINE_MAX_HEIGHT = Math.round(Dimensions.get("window").height * 0.4);

// Full-bleed paper background with a centered, width-capped content column.
// The outer View keeps the paper ground edge-to-edge; the inner column caps at
// `MaxContentWidth` and centers, so on wide windows — iPad, and "Designed for
// iPad" running resizable on Apple Silicon Macs — content reads as a comfortable
// editorial column with paper gutters instead of stretching full-bleed. On a
// phone the window is narrower than the cap, so the column is just 100% width
// (no visible effect). The caller's `style` lands on the inner column (where the
// children live) so existing per-screen layout — `centered` loading states,
// padded `container`s — behaves exactly as before.
export function Screen({ style, children, ...rest }: ViewProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.screen} {...rest}>
      <View style={[styles.screenContent, style]}>{children}</View>
    </View>
  );
}

// Mono uppercase eyebrow/folio label — the recurring "Section II — Catalogue"
// motif from the web header.
export function Eyebrow({ style, ...rest }: TextProps) {
  const styles = useThemedStyles(makeStyles);
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
  const styles = useThemedStyles(makeStyles);
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
  brandMark,
}: {
  eyebrow?: string;
  title: string;
  titleAccent?: string;
  subtitle?: string;
  count?: number | string;
  countLabel?: string;
  // Renders the rounded Sirius brand mark above the eyebrow. Reserved for
  // brand-entry surfaces (e.g. sign-in, the share tray) — not every page header.
  brandMark?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <View style={styles.headerMain}>
        {brandMark ? (
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.brandMark}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
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
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.meta, style]} {...rest} />;
}

// Mono uppercase tag, e.g. a post kind. `tone` overrides the color.
export function KindLabel({
  tone,
  style,
  ...rest
}: TextProps & { tone?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text
      style={[styles.kind, tone ? { color: tone } : null, style]}
      {...rest}
    />
  );
}

// A small colored dot + uppercase status label, mirroring the web StatusPip.
export function StatusPip({ label, color }: { label: string; color: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.pipRow}>
      <View style={[styles.pipDot, { backgroundColor: color }]} />
      <Text style={styles.pipLabel}>{label}</Text>
    </View>
  );
}

// Dot color for every stage of the mobile in-flight board's unified
// local+server continuum (Task 12 Step 6 — see @/lib/ingest-status). This is
// the function that ACTUALLY drives the visible board pips: library.tsx's
// `InFlightRow` calls `unifiedStatusColor` directly (`submissionStatusPip()`
// in constants/theme.ts mirrors it for the legacy 5-value server enum but has
// no live consumer — kept in sync for when/if it's wired up again).
//
// Task 13 WCAG-AA pass: `inkFaint` was dropped from this palette entirely —
// measured against the row's actual surface (`serverQueue`'s
// `t.color.paperRaised`, library.tsx) it comes in at only 1.74:1 (light) /
// 2.38:1 (dark), well under the 3:1 WCAG 1.4.11 non-text-contrast minimum for
// a dot that itself conveys status. (`inkFaint` is still fine for its
// documented decorative-only uses elsewhere, e.g. sheet handles — it was
// simply never AA-safe as a status *signal*.) That also fixed the original
// `queued`/`already_saved` collision (both were `inkFaint` — indistinguishable
// by color). `already_saved` now gets its own hue via the existing `warning`
// token (a muted amber already present in the token set, already verified as
// AA text-contrast-safe in both themes — see constants/theme.ts's ACCESSIBILITY
// CONTRACT note — so it clears the lower 3:1 non-text bar easily) rather than
// adding a new token, since `warning` already IS the "distinct muted amber"
// the plan called for. `uploading`/`received` intentionally still share
// `inkSubtle`: they're adjacent, sequential, transient pre-drafting stages,
// and `uploading` alone additionally renders the live `ProgressRow` bar, so
// the pair stays distinguishable without a 7th hue.
//
// Review-fix: `queued` had been folded into that same `inkSubtle` bucket,
// making it a 3-way collision with `uploading`/`received` (the binding
// constraint is no MORE than a 2-way share, and only for that
// progress-bar-differentiated pair). Moved `queued` to the existing `steel`
// token (a cool blue, already in both palettes, visually distinct from every
// other status hue in this switch) instead of adding a new token.
//
// Contrast ratios (dot vs `paperRaised` surface, WCAG 1.4.11 non-text ≥3:1):
//   queued        steel      light 5.61:1 / dark 5.48:1
//   uploading     inkSubtle  light 5.02:1 / dark 4.46:1
//   received      inkSubtle  light 5.02:1 / dark 4.46:1
//   drafting      accent     light 6.29:1 / dark 5.15:1
//   done          sage       light 4.80:1 / dark 6.30:1
//   failed        danger     light 5.56:1 / dark 5.42:1
//   already_saved warning    light 4.27:1 / dark 7.32:1
// Adjacent label text (StatusPip's `pipLabel`, always `t.color.inkMuted`, WCAG
// 1.4.3 text ≥4.5:1) vs the same surface: light 6.02:1 / dark 7.10:1 — passes
// for every status since the label color doesn't vary by status.
// (paperRaised: light #eadfc6, dark #1b2230 — see constants/theme.ts.)
//
// Colour is never the only signal: StatusPip above always renders the text
// label alongside the dot.
export function unifiedStatusColor(t: Theme, status: UnifiedStatus): string {
  switch (status) {
    case "queued":
      return t.color.steel;
    case "uploading":
      return t.color.inkSubtle;
    case "received":
      return t.color.inkSubtle;
    case "drafting":
      return t.color.accent;
    case "done":
      return t.color.sage;
    case "failed":
      return t.color.danger;
    case "already_saved":
      return t.color.warning;
    default:
      return t.color.inkMuted;
  }
}

// Live per-tick upload progress bar for an in-flight board row (Task 12
// Step 2). Subscribes DIRECTLY to the in-memory upload-progress emitter — not
// the SQLite live query the board itself is driven by — so the fill animates
// on every byte without re-running the board's per-item SELECT. Renders
// nothing once the row has moved past "uploading" (received/drafting/done/
// failed/already_saved all hide it). `reduced` (OS Reduce Motion) swaps the
// fill to a flatter, non-pulsing treatment; RN's plain View already renders a
// width change as an instant snap either way, so this is a style-only cue for
// now rather than a separate animation being disabled.
export function ProgressRow({ id, view }: { id: string; view: UnifiedView }) {
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const [pct, setPct] = useState(view.a11yValue?.now ?? getProgress(id)?.pct ?? 0);
  useEffect(() => subscribe(id, (s) => setPct(s.pct)), [id]);
  if (view.status !== "uploading") return null;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={view.a11yLabel}
    >
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${pct}%` },
            reduced && styles.progressFillStatic,
          ]}
        />
      </View>
    </View>
  );
}

// Terminal confirmation for the share/capture modals: once an item is queued
// the pane's only job is to let the user close it. Shared by `shareintent` and
// `capture` so both read identically.
export function CaptureDone({
  title = "Queued",
  message,
  onClose,
}: {
  title?: string;
  message?: string;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Screen style={styles.captureDone}>
      <PageHeader brandMark title={title} titleAccent="." subtitle={message} />
      <PrimaryButton label="Done" onPress={onClose} />
    </Screen>
  );
}

function Field({
  label,
  style,
  multiline,
  accessibilityLabel,
  ref,
  ...rest
}: TextInputProps & { label?: string; ref?: Ref<TextInput> }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Multiline inputs have no return-key dismiss on iOS; screens pair them with
  // a <KeyboardDoneButton/> near the submit control (see useKeyboardVisible).
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        ref={ref}
        style={[styles.input, multiline ? styles.inputMultiline : null, style]}
        placeholderTextColor={t.color.inkSubtle}
        selectionColor={t.color.accent}
        multiline={multiline}
        // Associate the visible label with the input so VoiceOver announces it
        // (the label <Text> alone is not programmatically linked). Falls back to
        // the placeholder when there's no label. Callers can still override.
        accessibilityLabel={accessibilityLabel ?? label ?? rest.placeholder}
        {...rest}
      />
    </View>
  );
}

export { Field };

// A password input with a trailing show/hide eye toggle. Mirrors Field's
// label + bordered input, but owns its own `secureTextEntry` state and reserves
// space on the right for the toggle control.
export function PasswordField({
  label,
  style,
  accessibilityLabel,
  ...rest
}: Omit<TextInputProps, "secureTextEntry"> & { label?: string }) {
  const [hidden, setHidden] = useState(true);
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.passwordRow}>
        <TextInput
          style={[styles.input, styles.passwordInput, style]}
          placeholderTextColor={t.color.inkSubtle}
          selectionColor={t.color.accent}
          secureTextEntry={hidden}
          accessibilityLabel={accessibilityLabel ?? label ?? rest.placeholder}
          {...rest}
        />
        <Pressable
          onPress={() => setHidden((h) => !h)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={hidden ? "Show password" : "Hide password"}
          style={({ pressed }) => [
            styles.passwordToggle,
            pressed && styles.linkPressed,
          ]}
        >
          <SymbolView
            name={hidden ? "eye" : "eye.slash"}
            size={20}
            weight="regular"
            tintColor={t.color.inkMuted}
            fallback={
              <Text style={styles.passwordToggleGlyph}>
                {hidden ? "Show" : "Hide"}
              </Text>
            }
          />
        </Pressable>
      </View>
    </View>
  );
}

// Imperative handle for an <AuthField/>: read the current text, focus, or clear.
export type AuthFieldHandle = {
  value: () => string;
  focus: () => void;
  clear: () => void;
};

// An UNCONTROLLED text field for the auth screens. Why not the controlled
// `Field`: under the iOS New Architecture (Fabric), a controlled TextInput can
// be recycled after Password Autofill and stop propagating updates, leaving the
// field visually empty (React Native issues #53050, #23921 — strong-password
// autofill can also fire onChangeText("") and clobber controlled state). Letting
// the native input own its text (`defaultValue`, no `value`) sidesteps both: we
// mirror the latest value into a ref via BOTH onChangeText and onEndEditing (the
// latter still carries the final native text when onChangeText was skipped), and
// the parent reads it at submit through the handle. Do NOT pass a `value` prop.
export function AuthField({
  label,
  style,
  accessibilityLabel,
  defaultValue,
  onChangeText,
  onEndEditing,
  ref,
  ...rest
}: Omit<TextInputProps, "value"> & {
  label?: string;
  ref?: Ref<AuthFieldHandle>;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const inputRef = useRef<TextInput>(null);
  const valueRef = useRef<string>(defaultValue ?? "");
  useImperativeHandle(
    ref,
    () => ({
      value: () => valueRef.current,
      focus: () => inputRef.current?.focus(),
      clear: () => {
        valueRef.current = "";
        inputRef.current?.clear();
      },
    }),
    [],
  );
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        ref={inputRef}
        style={[styles.input, style]}
        placeholderTextColor={t.color.inkSubtle}
        selectionColor={t.color.accent}
        defaultValue={defaultValue}
        accessibilityLabel={accessibilityLabel ?? label ?? rest.placeholder}
        onChangeText={(text) => {
          valueRef.current = text;
          onChangeText?.(text);
        }}
        onEndEditing={(event) => {
          valueRef.current = event.nativeEvent.text;
          onEndEditing?.(event);
        }}
        {...rest}
      />
    </View>
  );
}

// Tracks soft-keyboard visibility. The one reliable primitive for "is the
// keyboard up" — drives <KeyboardDoneButton/> and any keyboard-aware layout.
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

// Reusable keyboard-dismiss button. iOS multiline TextInputs have no return-key
// dismiss AND ignore `inputAccessoryViewID` (the old InputAccessoryView bar
// silently never rendered for them) — so a long note/chat message could trap the
// keyboard open. Drop this next to a screen's submit control: it shows only while
// the keyboard is up (iOS; Android has a system dismiss) and calls
// Keyboard.dismiss(). Caller owns placement via `style`.
export function KeyboardDoneButton({
  label = "Done",
  style,
}: {
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const visible = useKeyboardVisible();
  if (Platform.OS !== "ios" || !visible) {
    return null;
  }
  return (
    <Pressable
      onPress={() => Keyboard.dismiss()}
      hitSlop={8}
      accessibilityRole="button"
      // Accessible name must contain the visible text (WCAG 2.5.3 Label in Name)
      // so Voice Control "tap Done" works; the hint carries the description.
      accessibilityLabel={label}
      accessibilityHint="Dismisses the keyboard"
      style={({ pressed }) => [
        styles.keyboardDoneBtn,
        pressed && styles.linkPressed,
        style,
      ]}
    >
      <Text style={styles.keyboardDoneBtnText}>{label}</Text>
    </Pressable>
  );
}

// Compact agreement row for the auth screens: a tappable checkbox + an inline
// label whose document names can be links (nested <Text onPress>). The whole
// label also toggles, so the tap target isn't just the 24pt box. Controlled —
// the caller owns `checked`.
export function AgreeRow({
  checked,
  onToggle,
  disabled,
  accessibilityLabel,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  // Announced for the checkbox (the visual label may be link-fragmented).
  accessibilityLabel?: string;
  // Label content, rendered inside a <Text> — strings and nested <Text> links.
  children: ReactNode;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.agreeRow}>
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          styles.agreeBox,
          checked && styles.agreeBoxChecked,
          pressed && !disabled && styles.linkPressed,
        ]}
      >
        {checked ? (
          <SymbolView
            name="checkmark"
            size={14}
            weight="bold"
            tintColor={t.color.onAccent}
            fallback={<Text style={styles.agreeCheckGlyph}>✓</Text>}
          />
        ) : null}
      </Pressable>
      {/* onPress on the label toggles too; nested link <Text>s capture their
          own presses first, so tapping a document name opens it instead. */}
      <Text
        style={styles.agreeLabel}
        onPress={disabled ? undefined : onToggle}
        suppressHighlighting
      >
        {children}
      </Text>
    </View>
  );
}

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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
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
        <ActivityIndicator color={t.color.onAccent} />
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
  symbol,
  ...rest
}: ButtonProps & { symbol?: SFSymbol }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
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
        <ActivityIndicator color={t.color.accent} />
      ) : (
        <View style={styles.secondaryButtonContent}>
          {symbol ? (
            <SymbolView
              name={symbol}
              size={20}
              weight="medium"
              tintColor={t.color.accent}
              // Android/web have no SF Symbols; the label alone carries meaning.
              fallback={<></>}
            />
          ) : null}
          <Text style={styles.secondaryButtonText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// A bordered text link/button used in footers ("Sign out", "Create account").
export function TextLink({
  label,
  tone,
  accessibilityLabel,
  ...rest
}: Omit<PressableProps, "children"> & { label: string; tone?: string; accessibilityLabel?: string }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? label.replace(/[→←▸▹›‹✕·]/gu, "").trim()
      }
      hitSlop={12}
      style={({ pressed }) => [pressed && styles.linkPressed]}
      {...rest}
    >
      <Text style={[styles.link, { color: tone ?? t.color.accent }]}>
        {label}
      </Text>
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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
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
        tintColor={active ? t.color.accent : t.color.ink}
        fallback={
          <Text
            style={[styles.actionGlyph, active && { color: t.color.accent }]}
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

// Past this much downward drag (or a hard flick), releasing the grabber
// dismisses the sheet; anything less springs back to rest.
const SHEET_DISMISS_DISTANCE = 120;
const SHEET_DISMISS_VELOCITY = 800;

// A bottom modal sheet that hosts a single capture kind's input form. It can be
// dismissed three ways, so there's always an obvious way out: tap the scrim,
// tap the header close (✕) button, or drag the grabber down. The OS back
// gesture works too.
export function Sheet({
  visible,
  title,
  onClose,
  onDismiss,
  children,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  // Fires (iOS) once the slide-out has fully completed. Use this to present a
  // follow-on view controller (camera/picker) — presenting while the modal is
  // still dismissing wedges the app.
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  // Drives the drag-to-dismiss gesture. Both branches of onEnd land it back at
  // rest, so it's always 0 when the sheet is closed — no drag ever carries over
  // to the next open. Only tracks downward pull: pull down, never up.
  const dragY = useSharedValue(0);

  const dragGesture = Gesture.Pan()
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (
        e.translationY > SHEET_DISMISS_DISTANCE ||
        e.velocityY > SHEET_DISMISS_VELOCITY
      ) {
        // Snap to rest, then let the native slide-out play the exit.
        dragY.value = 0;
        scheduleOnRN(onClose);
      } else {
        dragY.value = withTiming(0, { duration: 180 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={onDismiss}
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
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: t.space.xl + insets.bottom },
            sheetStyle,
          ]}
        >
          {/* The grabber: a drag handle + the title/close row. Pan lives here
              (not the body) so dragging never fights the ScrollView. */}
          <GestureDetector gesture={dragGesture}>
            <View style={styles.sheetGrabber}>
              {/* Decorative drag affordance — VoiceOver users get the explicit
                  close button instead, so keep the handle out of the a11y tree. */}
              <View style={styles.sheetHandle} accessibilityElementsHidden />
              <View style={styles.sheetHeader}>
                {title ? (
                  <Eyebrow accessibilityRole="header" style={styles.sheetTitle}>
                    {title}
                  </Eyebrow>
                ) : null}
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={({ pressed }) => [
                    styles.sheetClose,
                    pressed && styles.sheetClosePressed,
                  ]}
                >
                  <SymbolView
                    name="xmark"
                    size={16}
                    weight="semibold"
                    tintColor={t.color.inkSubtle}
                    fallback={
                      <Text
                        style={styles.sheetCloseGlyph}
                        accessibilityElementsHidden
                      >
                        ✕
                      </Text>
                    }
                  />
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          {/* Scrollable body so a tall input (or any overflow) can never push
              the action buttons off-screen — everything stays reachable even
              with the keyboard up. */}
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetBodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// One staged item in the composer/share tray: a mono kind tag, a one-line
// description, an optional leading thumbnail, and edit + remove controls.
export function TrayRow({
  tag,
  description,
  onEdit,
  editLabel,
  onRemove,
  removeLabel,
  leading,
}: {
  tag: string;
  description: string;
  onEdit?: () => void;
  editLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
  leading?: ReactNode;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.trayRow}>
      {leading}
      <View style={styles.trayText}>
        <KindLabel tone={t.color.accent}>{tag}</KindLabel>
        <Text style={styles.trayDescription} numberOfLines={2}>
          {description}
        </Text>
      </View>
      {onEdit || onRemove ? (
        <View style={styles.trayActions}>
          {onEdit ? (
            <Pressable
              onPress={onEdit}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={editLabel ?? "Edit note"}
              style={({ pressed }) => [
                styles.trayEdit,
                pressed && styles.linkPressed,
              ]}
            >
              <Text style={styles.trayEditText}>✎</Text>
            </Pressable>
          ) : null}
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
      ) : null}
    </View>
  );
}

// Pinned bottom action bar for the composer. The Submit button used to be the
// last child of a long ScrollView (below the fold, dimmed when empty), so users
// didn't realize submission existed. This anchors an always-visible tray summary
// + Submit CTA just above the native tab bar (`BottomTabInset` + safe-area), so
// the action is discoverable without scrolling. It hides while the keyboard is
// up — main-screen text entry happens inside `Sheet` modals that render above
// this anyway. Reuses `PrimaryButton` for the CTA (keeps busy/disabled styling).
export function SubmitBar({
  count,
  busy,
  onSubmit,
  countLabel,
}: {
  count: number;
  busy?: boolean;
  onSubmit: () => void;
  countLabel?: string;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const empty = count === 0;

  // Subtle emphasis pulse on the count whenever an item is added — quick scale
  // bump, in keeping with the flat editorial motion language (no bounce).
  const scale = useSharedValue(1);
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) {
      scale.value = withSequence(
        withTiming(1.3, { duration: 120 }),
        withTiming(1, { duration: 160 }),
      );
    }
    prevCount.current = count;
  }, [count, scale]);
  const countStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  if (keyboardVisible) {
    return null;
  }

  return (
    <View
      style={[
        styles.submitBar,
        // Fill paper from the bar content all the way to the screen bottom so
        // the area behind the floating tab bar isn't see-through to scroll
        // content; the content row is pushed up to sit just above the tab bar.
        { paddingBottom: BottomTabInset + insets.bottom + t.space.md },
      ]}
    >
      <View style={styles.submitBarSummary}>
        <Eyebrow>In tray</Eyebrow>
        {empty ? (
          <Text style={styles.submitBarHint}>Nothing staged yet</Text>
        ) : (
          <Animated.Text
            style={[styles.submitBarCount, countStyle]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={countLabel}
          >
            {count}
          </Animated.Text>
        )}
      </View>
      <PrimaryButton
        label="Submit"
        onPress={onSubmit}
        busy={busy}
        disabled={empty}
        style={styles.submitBarButton}
      />
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.color.paper },
    screenContent: {
      flex: 1,
      width: "100%",
      maxWidth: MaxContentWidth,
      alignSelf: "center",
    },
    captureDone: {
      justifyContent: "center",
      paddingHorizontal: t.space.xl,
      gap: t.space.lg,
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: t.space.lg,
    },
    headerMain: { flex: 1, gap: t.space.xs },
    brandMark: {
      width: 52,
      height: 52,
      borderRadius: 12,
      marginBottom: t.space.sm,
    },
    eyebrow: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    title: {
      // Big page headline — the display face (Instrument Serif on Android,
      // New York on iOS). See theme `font.display`.
      fontFamily: t.font.display,
      fontSize: 40,
      lineHeight: 42,
      letterSpacing: -0.5,
      color: t.color.ink,
    },
    titleAccent: { color: t.color.accent },
    subtitle: {
      marginTop: t.space.sm,
      fontFamily: t.font.serif,
      fontSize: 17,
      lineHeight: 23,
      color: t.color.inkMuted,
    },
    headerCount: { alignItems: "flex-end" },
    countValue: {
      fontFamily: t.font.serif,
      fontSize: 34,
      lineHeight: 36,
      color: t.color.accent,
    },
    countLabel: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    meta: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkMuted,
    },
    kind: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.8,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    pipRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    pipDot: { width: 7, height: 7, borderRadius: t.radius.pill },
    pipLabel: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    progressTrack: {
      marginTop: 4,
      height: 4,
      width: "100%",
      borderRadius: t.radius.pill,
      backgroundColor: t.color.paperSunken,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: t.radius.pill,
      backgroundColor: t.color.accent,
    },
    progressFillStatic: { opacity: 0.85 },
    field: { gap: 6 },
    fieldLabel: {
      fontFamily: t.font.mono,
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    input: {
      borderWidth: 1,
      borderColor: t.color.ruleStrong,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperRaised,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 16,
      color: t.color.ink,
      minHeight: 48,
    },
    inputMultiline: {
      maxHeight: MULTILINE_MAX_HEIGHT,
      textAlignVertical: "top",
      paddingTop: 12,
    },
    passwordRow: { position: "relative", justifyContent: "center" },
    passwordInput: { paddingRight: 60 },
    passwordToggle: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    passwordToggleGlyph: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    primaryButton: {
      backgroundColor: t.color.accent,
      borderRadius: t.radius.none,
      paddingVertical: 15,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 50,
    },
    primaryButtonPressed: { backgroundColor: t.color.accentDeep },
    primaryButtonText: {
      color: t.color.onAccent,
      fontSize: 16,
      fontWeight: "600",
      letterSpacing: 0.3,
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: t.color.accent,
      borderRadius: t.radius.none,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
    },
    secondaryButtonPressed: { backgroundColor: t.color.accentSoft },
    secondaryButtonContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.sm,
    },
    secondaryButtonText: {
      color: t.color.accent,
      fontSize: 16,
      fontWeight: "600",
      letterSpacing: 0.3,
    },
    buttonDisabled: { opacity: 0.45 },
    agreeRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: t.space.md,
    },
    agreeBox: {
      width: 24,
      height: 24,
      borderWidth: 1,
      borderColor: t.color.ruleStrong,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperRaised,
      alignItems: "center",
      justifyContent: "center",
    },
    agreeBoxChecked: {
      backgroundColor: t.color.accent,
      borderColor: t.color.accent,
    },
    agreeCheckGlyph: {
      color: t.color.onAccent,
      fontSize: 14,
      lineHeight: 16,
      fontWeight: "700",
    },
    agreeLabel: {
      flex: 1,
      fontFamily: t.font.sans,
      fontSize: 13,
      lineHeight: 19,
      color: t.color.inkMuted,
    },
    submitBar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.lg,
      backgroundColor: t.color.paper,
      borderTopWidth: 1,
      borderColor: t.color.ruleStrong,
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.md,
    },
    submitBarSummary: { gap: t.space.xs },
    submitBarHint: {
      fontFamily: t.font.serif,
      fontSize: 15,
      fontStyle: "italic",
      color: t.color.inkMuted,
    },
    submitBarCount: {
      fontFamily: t.font.serif,
      fontSize: 30,
      lineHeight: 32,
      color: t.color.accent,
    },
    submitBarButton: { paddingHorizontal: t.space.xxl, minWidth: 150 },
    link: { fontSize: 15, fontWeight: "600" },
    linkPressed: { opacity: 0.6 },
    keyboardDoneBtn: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    keyboardDoneBtnText: {
      color: t.color.accent,
      fontSize: 14,
      fontWeight: "600",
    },
    actionCard: {
      flex: 1,
      // Square, clean tiles — width comes from flex, height matches via 1:1.
      aspectRatio: 1,
      borderWidth: 1,
      borderColor: t.color.rule,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperRaised,
      alignItems: "center",
      justifyContent: "center",
      gap: t.space.sm,
    },
    actionCardActive: {
      borderColor: t.color.accent,
      backgroundColor: t.color.accentSoft,
    },
    actionCardPressed: { backgroundColor: t.color.paperSunken },
    actionGlyph: {
      fontSize: 26,
      lineHeight: 30,
      color: t.color.ink,
      fontFamily: t.font.serif,
    },
    actionLabel: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    actionLabelActive: { color: t.color.accent },
    sheetScrim: {
      flex: 1,
      backgroundColor: t.color.scrim,
    },
    sheet: {
      backgroundColor: t.color.paper,
      borderTopWidth: 1,
      borderColor: t.color.ruleStrong,
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.md,
      gap: t.space.lg,
      // Never let the sheet swallow the whole screen: leave a tappable scrim gap
      // at the top (the requested top margin) so there's always a way out.
      maxHeight: "88%",
    },
    sheetBody: { flexShrink: 1 },
    sheetBodyContent: { gap: t.space.lg },
    // Handle + header grouped so the whole top band is the drag target. Extra
    // vertical padding gives the grabber a generous, finger-friendly hit area.
    sheetGrabber: { gap: t.space.md, paddingBottom: t.space.xs },
    sheetHandle: {
      alignSelf: "center",
      width: 44,
      height: 4,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.inkFaint,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
    },
    sheetTitle: { flex: 1 },
    sheetClose: {
      marginLeft: "auto",
      width: 32,
      height: 32,
      borderRadius: t.radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.color.paperRaised,
    },
    sheetClosePressed: { opacity: 0.6 },
    sheetCloseGlyph: { fontSize: 16, color: t.color.inkSubtle },
    trayRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
      borderWidth: 1,
      borderColor: t.color.rule,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperRaised,
      paddingVertical: t.space.sm,
      paddingHorizontal: t.space.md,
    },
    trayText: { flex: 1, gap: 3 },
    trayDescription: {
      fontSize: 15,
      fontWeight: "500",
      color: t.color.ink,
      fontFamily: t.font.serif,
    },
    trayActions: {
      flexDirection: "row",
      alignItems: "center",
    },
    trayEdit: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    trayEditText: {
      fontSize: 18,
      lineHeight: 22,
      color: t.color.inkMuted,
      fontWeight: "600",
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
      color: t.color.inkMuted,
      fontWeight: "600",
    },
  });
}
