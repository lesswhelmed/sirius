"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { signIn } from "../../../lib/auth-client";
import styles from "../auth.module.css";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn.email({
      email,
      password,
      callbackURL: "/",
    });
    setLoading(false);
    if (error) {
      setError(error.message ?? "Failed to sign in");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className={styles.card}>
      <span className={styles.mark} aria-hidden="true">
        Sirius.
      </span>
      <p className={styles.eyebrow}>Members &middot; Entry</p>
      <h1 className={styles.title}>
        Welcome <em>back.</em>
      </h1>
      <p className={styles.subtitle}>
        Sign in to continue your work in the field journal.
      </p>
      <div className={styles.rule} />

      <form className={styles.form} onSubmit={handleSubmit}>
        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@somewhere.world"
            required
            autoComplete="email"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
        </div>

        <button type="submit" className={styles.button} disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className={styles.footer}>
        <Link href="/forgot-password">Forgot password?</Link>
        <div>
          New here?{" "}
          <Link href="/sign-up">
            <span style={{ marginLeft: 4 }}>Create an account →</span>
          </Link>
        </div>
        <div>
          By signing in you agree to the{" "}
          <Link href="/terms">Terms of Use</Link>.
        </div>
      </div>
    </div>
  );
}
