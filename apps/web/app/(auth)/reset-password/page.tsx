"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { resetPassword } from "../../../lib/auth-client";
import styles from "../auth.module.css";

const MIN_LENGTH = 8;

// Error codes better-auth returns when the reset token is no longer usable.
const EXPIRED_CODES = new Set([
	"INVALID_TOKEN",
	"TOKEN_EXPIRED",
	"INVALID_OR_EXPIRED_TOKEN",
]);

export default function ResetPasswordPage() {
	return (
		<Suspense fallback={null}>
			<ResetPasswordForm />
		</Suspense>
	);
}

function ResetPasswordForm() {
	const router = useRouter();
	const params = useSearchParams();
	const token = params.get("token") ?? "";

	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [show, setShow] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expired, setExpired] = useState(false);
	const [success, setSuccess] = useState(false);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);

		if (!token) {
			setExpired(true);
			setError("This reset link is invalid or has expired.");
			return;
		}
		if (password.length < MIN_LENGTH) {
			setError(`Use at least ${MIN_LENGTH} characters.`);
			return;
		}
		if (password !== confirm) {
			setError("The two passwords don't match.");
			return;
		}

		setLoading(true);
		const { error } = await resetPassword({ newPassword: password, token });
		setLoading(false);
		if (error) {
			if (error.code && EXPIRED_CODES.has(error.code)) {
				setExpired(true);
				setError("This reset link is no longer valid. Request a new one.");
				return;
			}
			setError(error.message ?? "Failed to reset password");
			return;
		}
		setSuccess(true);
		setTimeout(() => router.push("/sign-in"), 1200);
	}

	return (
		<div className={styles.card}>
			<span className={styles.mark} aria-hidden="true">
				Sirius.
			</span>
			<p className={styles.eyebrow}>Members &middot; New key</p>
			<h1 className={styles.title}>
				Set a new <em>password.</em>
			</h1>
			<p className={styles.subtitle}>
				Choose something strong you don&apos;t use elsewhere.
			</p>
			<div className={styles.rule} />

			<form className={styles.form} onSubmit={handleSubmit}>
				{error ? <div className={styles.error}>{error}</div> : null}
				{success ? (
					<div className={styles.success}>
						Password updated. Taking you to sign in&hellip;
					</div>
				) : null}

				{expired ? (
					<div className={styles.footer}>
						<Link href="/forgot-password">Request a new reset link →</Link>
					</div>
				) : (
					<>
						<div className={styles.field}>
							<label className={styles.label} htmlFor="password">
								New password
							</label>
							<div className={styles.inputWrap}>
								<input
									id="password"
									type={show ? "text" : "password"}
									className={styles.input}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="At least 8 characters"
									required
									minLength={MIN_LENGTH}
									autoComplete="new-password"
									disabled={loading || success}
								/>
								<button
									type="button"
									className={styles.toggle}
									onClick={() => setShow((s) => !s)}
									aria-pressed={show}
									aria-label={show ? "Hide password" : "Show password"}
								>
									{show ? "Hide" : "Show"}
								</button>
							</div>
						</div>

						<div className={styles.field}>
							<label className={styles.label} htmlFor="confirm">
								Confirm password
							</label>
							<div className={styles.inputWrap}>
								<input
									id="confirm"
									type={show ? "text" : "password"}
									className={styles.input}
									value={confirm}
									onChange={(e) => setConfirm(e.target.value)}
									placeholder="Re-enter password"
									required
									minLength={MIN_LENGTH}
									autoComplete="new-password"
									disabled={loading || success}
								/>
							</div>
						</div>

						<button
							type="submit"
							className={styles.button}
							disabled={loading || success}
						>
							{loading ? "Saving…" : "Save password"}
						</button>
					</>
				)}
			</form>

			<div className={styles.footer}>
				<Link href="/sign-in">← Back to entry</Link>
			</div>
		</div>
	);
}
