import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";

import { authSecureStorage } from "@/lib/secure-storage";

const baseURL =
  process.env.EXPO_PUBLIC_AUTH_BASE_URL ?? "http://localhost:3000";

export const authClient = createAuthClient({
  baseURL,
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
