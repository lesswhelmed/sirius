import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";

import { useSession } from "@/lib/auth-client";

export default function Index() {
	const { data: session, isPending } = useSession();
	if (isPending) {
		return (
			<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
				<ActivityIndicator />
			</View>
		);
	}
	return session ? (
		<Redirect href="/(tabs)/library" />
	) : (
		<Redirect href="/(auth)/sign-in" />
	);
}
