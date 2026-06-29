// The Friends tab (UI label "Friends"; route name `feed` to avoid colliding
// with the off-tab People-management screen at `app/friends.tsx`, which owns the
// `/friends` URL). Hosts the merged shared-posts stream — the viewer's own shared
// posts interleaved with friends'/public posts, newest first — moved here out of
// the Catalog tab's old Mine/Friends toggle. The People and Groups managers stay
// off-tab; a header affordance links to them so the bottom nav stays feed-first.
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { FriendsFeedList } from "@/components/friends-feed-list";
import { PageHeader, Screen, TextLink } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";

export default function FeedScreen() {
  const styles = useThemedStyles(makeStyles);
  // Rendered as the list header so the page title + management links scroll with
  // the feed (the list owns the single scroll container).
  const header = (
    <>
      <PageHeader
        eyebrow="Shared"
        title="Friends"
        titleAccent="."
        subtitle="Posts you and your friends have shared."
      />
      <View style={styles.nav}>
        <TextLink label="People →" onPress={() => router.push("/friends")} />
        <TextLink label="Groups →" onPress={() => router.push("/groups")} />
      </View>
    </>
  );
  return (
    <Screen>
      <FriendsFeedList header={header} />
    </Screen>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    nav: {
      flexDirection: "row",
      gap: t.space.xl,
      marginTop: t.space.md,
    },
  });
}
