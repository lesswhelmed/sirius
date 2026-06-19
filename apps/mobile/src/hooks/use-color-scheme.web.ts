import { useSyncExternalStore } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

const emptySubscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * useSyncExternalStore returns the server snapshot (false) during SSR and the
 * client snapshot (true) after hydration — without a setState-in-effect.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return "light";
}
