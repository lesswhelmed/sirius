import { redirect } from "next/navigation";

// The Library was merged into the owner Catalog. Preserve old/bookmarked links
// by sending them to /catalog, which now browses all ingested content.
export default function LibraryRedirect() {
  redirect("/catalog");
}
