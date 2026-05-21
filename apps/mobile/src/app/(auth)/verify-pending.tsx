import { Link, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { authClient } from "@/lib/auth-client";

export default function VerifyPendingScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!email || busy) return;
    setBusy(true);
    const { error } = await authClient.sendVerificationEmail({ email });
    setBusy(false);
    Alert.alert(
      error ? "Could not resend" : "Email sent",
      error?.message ?? "Check your inbox for the verification link."
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.body}>
        We sent a verification link to{"\n"}
        <Text style={styles.email}>{email ?? "your email address"}</Text>.
        {"\n\n"}Open it on this device, then come back here and sign in.
      </Text>
      <Pressable
        onPress={resend}
        disabled={busy || !email}
        style={({ pressed }) => [
          styles.secondaryButton,
          (busy || pressed) && styles.pressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.secondaryButtonText}>Resend email</Text>
        )}
      </Pressable>
      <Link href="/(auth)/sign-in" style={styles.link}>
        Back to sign in
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 96,
    gap: 18,
  },
  title: { fontSize: 28, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 24, color: "#3C424D" },
  email: { fontWeight: "600", color: "#000" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#208AEF",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#208AEF", fontSize: 16, fontWeight: "500" },
  pressed: { opacity: 0.7 },
  link: {
    color: "#208AEF",
    textAlign: "center",
    marginTop: 8,
    fontWeight: "500",
  },
});
