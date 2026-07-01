// Liquid-glass surface primitives. On iOS 26+ these render expo-glass-effect's
// native GlassView (a real UIVisualEffectView liquid-glass material); on every
// other target (Android, iOS < 26, or the iOS-26 betas that shipped without the
// API) they degrade to a plain View carrying the caller's editorial fallback
// style — so no screen regresses and callers keep ONE JSX shape.
//
// Contract: `style` is shared layout (padding, flex, minHeight) applied in BOTH
// branches; `glassStyle` is applied ONLY when glass renders (radius, hairline
// glow, overflow-clip); `fallbackStyle` is applied ONLY in the plain-View branch
// (the opaque bordered card that matches today's look).
import {
  GlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import {
  type StyleProp,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";

// Resolve once at module load — these are synchronous native availability
// checks. `isGlassEffectAPIAvailable` guards the iOS-26 betas that lacked the
// API (touching GlassView there crashes); the try/catch tolerates older
// expo-glass-effect builds that don't export it yet.
export const glassAvailable: boolean = (() => {
  try {
    if (
      typeof isGlassEffectAPIAvailable === "function" &&
      !isGlassEffectAPIAvailable()
    ) {
      return false;
    }
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

export type GlassSurfaceProps = ViewProps & {
  /** 'regular' = frosted material; 'clear' = more transparent. */
  glass?: "regular" | "clear";
  /** Enables the interactive (touch-reactive) liquid effect. */
  isInteractive?: boolean;
  tintColor?: string;
  /** Applied only when the native glass renders (radius, glow, clip). */
  glassStyle?: StyleProp<ViewStyle>;
  /** Applied only in the plain-View fallback (opaque editorial card). */
  fallbackStyle?: StyleProp<ViewStyle>;
};

export function GlassSurface({
  glass = "regular",
  isInteractive = false,
  tintColor,
  glassStyle,
  fallbackStyle,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  if (glassAvailable) {
    return (
      <GlassView
        glassEffectStyle={glass}
        isInteractive={isInteractive}
        tintColor={tintColor}
        style={[style, glassStyle]}
        {...rest}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[style, fallbackStyle]} {...rest}>
      {children}
    </View>
  );
}

// Groups adjacent GlassSurfaces so their materials fluidly merge/separate as
// they approach within `spacing` px. Falls back to a plain View wrapper.
export function GlassRow({
  spacing = 16,
  style,
  children,
  ...rest
}: ViewProps & { spacing?: number }) {
  if (glassAvailable) {
    return (
      <GlassContainer spacing={spacing} style={style} {...rest}>
        {children}
      </GlassContainer>
    );
  }
  return (
    <View style={style} {...rest}>
      {children}
    </View>
  );
}
