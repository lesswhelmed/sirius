import { redirect } from "next/navigation";

// Queue folded into the Catalog (in-flight section). This route stays for
// back-compat (bookmarks/links) and redirects unconditionally.
export default function QueuePage() {
  redirect("/catalog");
}
