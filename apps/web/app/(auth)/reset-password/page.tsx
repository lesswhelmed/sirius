"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { resetPassword } from "../../../lib/auth-client";
import styles from "../auth.module.css";

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing reset token. Request a new reset email.");
      return;
    }

    setLoading(true);
    const { error } = await resetPassword({
      newPassword: password,
      token,
    });
    setLoading(false);
    if (error) {
      setError(error.message ?? "Failed to reset password");
      return;
    }
    router.push("/sign-in");
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Set a new password</h1>
      <p className={styles.subtitle}>Choose a strong password you don&apos;t use elsewhere.</p>

      <form className={styles.form} onSubmit={handleSubmit}>
        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            New password
          </label>
          <input
            id="password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        <button type="submit" className={styles.button} disabled={loading}>
          {loading ? "Saving…" : "Save password"}
        </button>
      </form>

      <div className={styles.footer}>
        <Link href="/sign-in">Back to sign in</Link>
      </div>
    </div>
  );
}
