import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";

import { authSecureStorage } from "@/lib/secure-storage";

const baseURL =
  process.env.EXPO_PUBLIC_AUTH_BASE_URL ?? "http://localhost:3000";

export const authClient = createAuthClient({
  baseURL,
  // No session refetch on app foreground: the sync engine
  // (src/lib/sync/engine.ts revalidateThenSync) already confirms the server
  // session on every foreground for signed-in users and signs out on an
  // authoritative "none". For signed-out users the focus refetch only flipped
  // useSession().isPending (better-auth sets isPending = data === null on
  // every refetch), which remounted the (auth) screens and wiped in-progress
  // input during iOS password autofill.
  sessionOptions: {
    refetchOnWindowFocus: false,
  },
  plugins: [
    expoClient({
      scheme: "siriusapp",
      storagePrefix: "siriusapp",
      // Never raw SecureStore: the plugin reads synchronously at import time,
      // and a locked-device launch would throw errSecInteractionNotAllowed
      // before any screen mounts. See secure-storage.ts.
      storage: authSecureStorage,
    }),
  ],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  requestPasswordReset,
  resetPassword,
  deleteUser,
} = authClient;

export { baseURL as authBaseURL };
