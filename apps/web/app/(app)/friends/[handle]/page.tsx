// The friend catalog now lives on the unified, shareable profile at /u/[handle]
// (a signed-in accepted friend sees the catalog there). This route is kept only
// as a permanent redirect so any existing /friends/<handle> links/bookmarks
// resolve instead of 404-ing.
import { redirect } from "next/navigation";

export default async function FriendCatalogRedirect({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  redirect(`/u/${handle}`);
}
