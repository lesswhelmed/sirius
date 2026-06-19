import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
	Alert,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	View,
} from "react-native";

import {
	AuthField,
	type AuthFieldHandle,
	Eyebrow,
	PrimaryButton,
	Screen,
	SecondaryButton,
	Sheet,
	TextLink,
	Title,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { signIn, signOut, useSession } from "@/lib/auth-client";
import {
	type BiometricType,
	biometricLabel,
	disableBiometric,
	enableBiometric,
	getBiometricCapability,
	isBiometricEnabled,
} from "@/lib/biometric-auth";

export default function SettingsScreen() {
	const { data: session } = useSession();
	const email = session?.user?.email ?? "";
	const name = session?.user?.name ?? "";
	// `handle` is an extra profile field on the user (see schema); not in the
	// base better-auth type, so read it defensively.
	const handle = (session?.user as { handle?: string | null } | undefined)
		?.handle;

	const [bioCapable, setBioCapable] = useState(false);
	const [bioType, setBioType] = useState<BiometricType>("none");
	const [bioEnabled, setBioEnabled] = useState(() => isBiometricEnabled());
	const [confirmVisible, setConfirmVisible] = useState(false);
	const [confirmBusy, setConfirmBusy] = useState(false);
	const passwordRef = useRef<AuthFieldHandle>(null);

	useEffect(() => {
		let active = true;
		void getBiometricCapability().then((cap) => {
			if (!active) return;
			setBioCapable(cap.available);
			setBioType(cap.type);
		});
		return () => {
			active = false;
		};
	}, []);

	const label = biometricLabel(bioType);

	function onToggleBiometric(next: boolean) {
		if (next) {
			// Enabling requires the password (we don't hold it post-login). Confirm
			// identity before arming biometrics — also the more secure path.
			setConfirmVisible(true);
		} else {
			void disableBiometric().then(() => setBioEnabled(false));
		}
	}

	async function handleConfirmEnable() {
		if (confirmBusy) return;
		const password = passwordRef.current?.value() ?? "";
		if (!password) {
			Alert.alert(
				"Enter your password",
				`Confirm your password to enable ${label}.`,
			);
			return;
		}
		setConfirmBusy(true);
		// Verify the password is correct before sealing it in the keychain.
		const { error } = await signIn.email({ email, password });
		if (error) {
			setConfirmBusy(false);
			Alert.alert(
				"Couldn’t verify",
				error.message ?? "That password didn’t match. Try again.",
			);
			return;
		}
		try {
			await enableBiometric(email, password);
			setBioEnabled(true);
			setConfirmVisible(false);
			passwordRef.current?.clear();
		} catch (err) {
			console.warn("[settings] enableBiometric failed", err);
			Alert.alert(
				"Couldn’t enable",
				`${label} couldn’t be set up on this device.`,
			);
		} finally {
			setConfirmBusy(false);
		}
	}

	async function handleSignOut() {
		// Wipe the biometric vault on sign-out so a saved password never outlives
		// the session on a shared device.
		await disableBiometric();
		await signOut();
		router.replace("/(auth)/sign-in");
	}

	return (
		<Screen>
			<ScrollView contentContainerStyle={styles.container}>
				<View style={styles.headerMain}>
					<Eyebrow>Section IV — Account</Eyebrow>
					<Title accent="." accessibilityRole="header">
						Settings
					</Title>
				</View>

				{/* Account */}
				<View style={styles.section}>
					<Text style={styles.sectionLabel}>Account</Text>
					<View style={styles.card}>
						{name ? <Row label="Name" value={name} /> : null}
						<Row label="Email" value={email || "—"} />
						{handle ? <Row label="Handle" value={`@${handle}`} /> : null}
					</View>
				</View>

				{/* Security */}
				<View style={styles.section}>
					<Text style={styles.sectionLabel}>Security</Text>
					<View style={styles.card}>
						{bioCapable ? (
							<View style={styles.toggleRow}>
								<View style={styles.toggleText}>
									<Text
										style={styles.toggleTitle}
									>{`Sign in with ${label}`}</Text>
									<Text style={styles.toggleSub}>
										{bioEnabled
											? `${label} is on. Your credentials are encrypted on this device.`
											: `Use ${label} to sign in without typing your password.`}
									</Text>
								</View>
								<Switch
									value={bioEnabled}
									onValueChange={onToggleBiometric}
									trackColor={{
										false: Sirius.color.rule,
										true: Sirius.color.accent,
									}}
									thumbColor={Sirius.color.paper}
									ios_backgroundColor={Sirius.color.rule}
								/>
							</View>
						) : (
							<Text style={styles.toggleSub}>
								Biometric sign-in isn’t available on this device. Set up Face ID
								or Touch ID in your device settings to use it.
							</Text>
						)}
					</View>
				</View>

				{/* Sign out */}
				<View style={styles.section}>
					<SecondaryButton label="Sign out" onPress={handleSignOut} />
				</View>
			</ScrollView>

			<Sheet
				visible={confirmVisible}
				title={`Enable ${label}`}
				onClose={() => {
					if (confirmBusy) return;
					passwordRef.current?.clear();
					setConfirmVisible(false);
				}}
			>
				<Text style={styles.sheetCopy}>
					{`Confirm your password to turn on ${label} sign-in. It’s sealed in this device’s Secure Enclave and never leaves it.`}
				</Text>
				<AuthField
					label="Password"
					placeholder="Your password"
					secureTextEntry
					autoComplete="password"
					textContentType="password"
					editable={!confirmBusy}
					ref={passwordRef}
				/>
				<PrimaryButton
					label="Enable"
					busy={confirmBusy}
					onPress={handleConfirmEnable}
				/>
				<View style={styles.sheetCancel}>
					<TextLink
						label="Cancel"
						tone={Sirius.color.inkMuted}
						onPress={() => {
							if (confirmBusy) return;
							passwordRef.current?.clear();
							setConfirmVisible(false);
						}}
					/>
				</View>
			</Sheet>
		</Screen>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<View style={styles.row}>
			<Text style={styles.rowLabel}>{label}</Text>
			<Text style={styles.rowValue} numberOfLines={1}>
				{value}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		paddingHorizontal: Sirius.space.xl,
		paddingTop: Sirius.space.xl,
		paddingBottom: 120,
		gap: Sirius.space.xl,
	},
	headerMain: { gap: Sirius.space.xs },
	section: { gap: Sirius.space.sm },
	sectionLabel: {
		fontFamily: Sirius.font.mono,
		fontSize: 11,
		letterSpacing: 1,
		textTransform: "uppercase",
		color: Sirius.color.inkSubtle,
	},
	card: {
		borderWidth: 1,
		borderColor: Sirius.color.rule,
		backgroundColor: Sirius.color.paperRaised,
		paddingHorizontal: Sirius.space.lg,
		paddingVertical: Sirius.space.sm,
		gap: Sirius.space.sm,
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: Sirius.space.lg,
		paddingVertical: Sirius.space.sm,
	},
	rowLabel: {
		fontFamily: Sirius.font.mono,
		fontSize: 12,
		color: Sirius.color.inkSubtle,
	},
	rowValue: {
		flexShrink: 1,
		fontFamily: Sirius.font.serif,
		fontSize: 16,
		color: Sirius.color.ink,
	},
	toggleRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: Sirius.space.lg,
		paddingVertical: Sirius.space.sm,
	},
	toggleText: { flex: 1, gap: 2 },
	toggleTitle: {
		fontFamily: Sirius.font.serif,
		fontSize: 17,
		color: Sirius.color.ink,
	},
	toggleSub: {
		fontFamily: Sirius.font.sans,
		fontSize: 13,
		lineHeight: 18,
		color: Sirius.color.inkMuted,
	},
	sheetCopy: {
		fontFamily: Sirius.font.sans,
		fontSize: 14,
		lineHeight: 20,
		color: Sirius.color.inkMuted,
	},
	sheetCancel: { alignItems: "center", marginTop: Sirius.space.xs },
});
