// Biometric (Face ID / Touch ID) credential vault.
//
// What this is: an opt-in "sign in with Face ID" path. After a successful
// password login the user can arm biometrics; we seal their email + password in
// the iOS Keychain behind the Secure Enclave (`requireAuthentication`), so a
// later Face ID scan can re-run the real better-auth sign-in without the user
// retyping — and without depending on OS autofill, which is the thing that was
// failing on the login screen.
//
// Security posture (see docs/superpowers/specs/2026-06-18-biometric-faceid-signin-design.md):
//   - Credentials live ONLY in the Keychain, gated by `requireAuthentication`
//     (the OS raises the biometric prompt on read; a failed/cancelled scan
//     returns nothing).
//   - `keychainAccessible: WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` → not in device
//     backups, not iCloud-synced, device-bound, and auto-wiped if the user
//     removes their passcode.
//   - Never logged, never transmitted anywhere except the existing HTTPS
//     better-auth sign-in endpoint.
//
// The Secure Enclave ACL is the authority for the gate. `expo-local-authentication`
// is used ONLY to detect capability + label "Face ID" vs "Touch ID" — never for
// a second prompt (that would double-prompt the user).
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

// Keys mirror the `siriusapp` storage prefix used by the auth client + recovery
// helpers (see auth-client.ts / auth-recovery.ts). Keep in sync if it changes.
const CREDENTIALS_KEY = "siriusapp_biometric_credentials"; // gated (requireAuthentication)
const ENABLED_KEY = "siriusapp_biometric_enabled"; // non-sensitive flag
const EMAIL_KEY = "siriusapp_biometric_email"; // non-sensitive, for the prompt label

// Options for the gated credential item: biometric-gated, device-only, never
// synced or backed up.
const GATED_OPTIONS: SecureStore.SecureStoreOptions = {
	requireAuthentication: true,
	keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
	authenticationPrompt: "Sign in to Sirius",
};

// Plain (non-gated) device-only options for the flag + email. Readable on a
// cold launch without a prompt so the sign-in screen can decide whether to show
// the Face ID button synchronously.
const PLAIN_OPTIONS: SecureStore.SecureStoreOptions = {
	keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type BiometricType = "face" | "touch" | "none";

export type BiometricCapability = {
	available: boolean;
	type: BiometricType;
};

export type StoredCredentials = {
	email: string;
	password: string;
};

// Whether this device can do biometric auth right now: hardware present AND the
// user has enrolled a face/fingerprint. `type` drives correct labeling.
export async function getBiometricCapability(): Promise<BiometricCapability> {
	try {
		const [hasHardware, isEnrolled, types] = await Promise.all([
			LocalAuthentication.hasHardwareAsync(),
			LocalAuthentication.isEnrolledAsync(),
			LocalAuthentication.supportedAuthenticationTypesAsync(),
		]);
		if (!hasHardware || !isEnrolled) {
			return { available: false, type: "none" };
		}
		const type: BiometricType = types.includes(
			LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
		)
			? "face"
			: types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
				? "touch"
				: "none";
		return { available: true, type };
	} catch {
		return { available: false, type: "none" };
	}
}

// Human label for the current modality, e.g. "Face ID". Falls back to a generic
// term when the type is unknown.
export function biometricLabel(type: BiometricType): string {
	if (type === "face") return "Face ID";
	if (type === "touch") return "Touch ID";
	return "biometrics";
}

// Synchronous: has the user armed biometric login on this device? Reads the
// non-gated flag (no prompt). Safe to call during render.
export function isBiometricEnabled(): boolean {
	try {
		return SecureStore.getItem(ENABLED_KEY) === "1";
	} catch {
		return false;
	}
}

// The email biometric login is armed for (non-sensitive — shown as "Sign in as
// you@…"). Null when not enabled.
export function getEnrolledEmail(): string | null {
	try {
		return SecureStore.getItem(EMAIL_KEY);
	} catch {
		return null;
	}
}

// Arm biometric login: seal the credentials behind the Secure Enclave and set
// the non-gated flag + email. Callers MUST confirm `getBiometricCapability()`
// first — writing a gated item on a device with no enrolled biometrics throws.
// Throws on failure so the caller can surface it (we don't want a silent "it
// looked like it saved" — see CLAUDE.md on silent failures).
export async function enableBiometric(
	email: string,
	password: string,
): Promise<void> {
	await SecureStore.setItemAsync(
		CREDENTIALS_KEY,
		JSON.stringify({ email, password } satisfies StoredCredentials),
		GATED_OPTIONS,
	);
	await SecureStore.setItemAsync(EMAIL_KEY, email, PLAIN_OPTIONS);
	await SecureStore.setItemAsync(ENABLED_KEY, "1", PLAIN_OPTIONS);
}

// Read the sealed credentials. The OS raises the biometric prompt here (via the
// keychain ACL). Returns null on cancel, failure, or if nothing is stored —
// never throws, so the caller falls back to manual sign-in cleanly.
export async function getBiometricCredentials(): Promise<StoredCredentials | null> {
	try {
		const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY, GATED_OPTIONS);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredCredentials;
		if (
			typeof parsed?.email !== "string" ||
			typeof parsed?.password !== "string"
		) {
			return null;
		}
		return parsed;
	} catch {
		// User cancelled the scan, it failed, or the item is gone — all "no creds".
		return null;
	}
}

// Disarm biometric login and wipe every trace. Called on explicit disable, on
// sign-out, and when the server rejects the saved password (credential rotation).
// Best-effort; never throws.
export async function disableBiometric(): Promise<void> {
	await Promise.all([
		SecureStore.deleteItemAsync(CREDENTIALS_KEY, GATED_OPTIONS).catch(() => {}),
		SecureStore.deleteItemAsync(EMAIL_KEY, PLAIN_OPTIONS).catch(() => {}),
		SecureStore.deleteItemAsync(ENABLED_KEY, PLAIN_OPTIONS).catch(() => {}),
	]);
}
