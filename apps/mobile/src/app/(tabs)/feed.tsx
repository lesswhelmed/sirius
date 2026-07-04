// The Friends tab (UI label "Friends"; route name `feed` to avoid colliding
// with the off-tab People-management screen at `app/friends.tsx`, which owns the
// `/friends` URL). Hosts the merged shared-posts stream — the viewer's own shared
// posts interleaved with friends'/public posts, newest first — moved here out of
// the Catalog tab's old Mine/Friends toggle. The People and Groups managers stay
// off-tab; a header affordance links to them so the bottom nav stays feed-first.
import { StyleSheet, View } from "react-native";

import { FriendsFeedList } from "@/components/friends-feed-list";
import { RequestBadge } from "@/components/request-badge";
import { PageHeader, Screen, TextLink } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import { pushOnce } from "@/lib/nav";
import { useIncomingRequestCount } from "@/lib/use-incoming-request-count";

export default function FeedScreen() {
  const styles = useThemedStyles(makeStyles);
  // Incoming friend-request count for the "People →" affordance. Shares the
  // ["friend-requests"] cache with the nav-tab badge + People manager.
  const incomingRequests = useIncomingRequestCount();
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
        <View style={styles.navItem}>
          <TextLink label="People →" onPress={() => pushOnce("/friends")} />
          <RequestBadge count={incomingRequests} />
        </View>
        <TextLink label="Groups →" onPress={() => pushOnce("/groups")} />
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
    navItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.sm,
    },
  });
}
