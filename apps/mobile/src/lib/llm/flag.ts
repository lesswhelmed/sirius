// Master build-time switch for ALL on-device LLM work. EXPO_PUBLIC_* is inlined
// by Expo at build time, so this is a compile-time gate: when off, no model
// download/load/inference UI or code path is reachable. The native llama.rn
// bridge is still bundled (verify:native-ai unaffected) — only the JS feature
// is hidden, so flipping the env back on needs no native change.
export const ON_DEVICE_AI_ENABLED =
  process.env.EXPO_PUBLIC_ON_DEVICE_AI === "true";
