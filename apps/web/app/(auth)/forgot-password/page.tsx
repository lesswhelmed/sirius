"use client";

import Link from "next/link";
import { useState } from "react";

import { requestPasswordReset } from "../../../lib/auth-client";
import styles from "../auth.module.css";

export default function ForgotPasswordPage() {
	const [email, setEmail] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setLoading(true);
		const { error } = await requestPasswordReset({
			email,
			redirectTo: "/reset-password",
		});
		setLoading(false);
		if (error) {
			setError(error.message ?? "Failed to send reset email");
			return;
		}
		setSuccess(true);
	}

	return (
		<div className={styles.card}>
			<span className={styles.mark} aria-hidden="true">
				Sirius.
			</span>
			<p className={styles.eyebrow}>Members &middot; Lost key</p>
			<h1 className={styles.title}>
				Forgot the <em>password?</em>
			</h1>
			<p className={styles.subtitle}>
				Enter the email on file and we&apos;ll send a reset link.
			</p>
			<div className={styles.rule} />

			<form className={styles.form} onSubmit={handleSubmit}>
				{error ? <div className={styles.error}>{error}</div> : null}
				{success ? (
					<div className={styles.success}>
						If an account exists for {email}, a reset link is on its way.
					</div>
				) : null}

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

				<button type="submit" className={styles.button} disabled={loading}>
					{loading ? "Sending…" : "Send reset link"}
				</button>
			</form>

			<div className={styles.footer}>
				<Link href="/sign-in">← Back to entry</Link>
			</div>
		</div>
	);
}
