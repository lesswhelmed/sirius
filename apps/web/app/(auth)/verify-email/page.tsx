"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { sendVerificationEmail } from "../../../lib/auth-client";
import styles from "../auth.module.css";

export default function VerifyEmailPage() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";

  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleResend() {
    if (!email) {
      setError("Missing email. Sign up again to receive a verification link.");
      return;
    }
    setError(null);
    setLoading(true);
    const { error } = await sendVerificationEmail({
      email,
      callbackURL: "/",
    });
    setLoading(false);
    if (error) {
      setError(error.message ?? "Failed to resend verification email");
      return;
    }
    setSent(true);
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Check your email</h1>
      <p className={styles.subtitle}>
        {email
          ? `We sent a verification link to ${email}.`
          : "We sent you a verification link."}{" "}
        Click it to finish signing up.
      </p>

      <div className={styles.form}>
        {error ? <div className={styles.error}>{error}</div> : null}
        {sent ? (
          <div className={styles.success}>Verification email resent.</div>
        ) : null}

        <button
          type="button"
          className={styles.button}
          onClick={handleResend}
          disabled={loading}
        >
          {loading ? "Resending…" : "Resend verification email"}
        </button>
      </div>

      <div className={styles.footer}>
        <Link href="/sign-in">Back to sign in</Link>
      </div>
    </div>
  );
}
