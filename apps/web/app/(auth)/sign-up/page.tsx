"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { signUp } from "../../../lib/auth-client";
import styles from "../auth.module.css";

export default function SignUpPage() {
	const router = useRouter();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setLoading(true);
		const { error } = await signUp.email({
			email,
			password,
			name,
		});
		setLoading(false);
		if (error) {
			setError(error.message ?? "Failed to sign up");
			return;
		}
		router.push(`/verify-email?email=${encodeURIComponent(email)}`);
	}

	return (
		<div className={styles.card}>
			<span className={styles.mark} aria-hidden="true">
				Sirius.
			</span>
			<p className={styles.eyebrow}>Members &middot; New file</p>
			<h1 className={styles.title}>
				Open an <em>account.</em>
			</h1>
			<p className={styles.subtitle}>
				We&apos;ll send a verification letter to confirm it&apos;s really you.
			</p>
			<div className={styles.rule} />

			<form className={styles.form} onSubmit={handleSubmit}>
				{error ? <div className={styles.error}>{error}</div> : null}

				<div className={styles.field}>
					<label className={styles.label} htmlFor="name">
						Name
					</label>
					<input
						id="name"
						type="text"
						className={styles.input}
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="As you&apos;d like it printed"
						required
						autoComplete="name"
					/>
				</div>

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
						placeholder="At least 8 characters"
						required
						minLength={8}
						autoComplete="new-password"
					/>
				</div>

				<button type="submit" className={styles.button} disabled={loading}>
					{loading ? "Filing…" : "Create account"}
				</button>
			</form>

			<div className={styles.footer}>
				Already on the register?{" "}
				<Link href="/sign-in">
					<span style={{ marginLeft: 4 }}>Sign in →</span>
				</Link>
			</div>
		</div>
	);
}
