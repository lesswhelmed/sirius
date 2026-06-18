import { redirect } from "next/navigation";

// Where to send a viewer who may not see catalog content while the public
// catalog is disabled (see PUBLIC_CATALOG_ENABLED in ./features). Kept in one
// place so the "blocked viewer" destination is decided once.
//
// Signed-out visitors go to /sign-in and return to where they were. An
// already-signed-in non-owner is instead sent to their own /catalog: the
// /sign-in page is a client form that does not auto-bounce an authenticated
// user, so routing them there would dead-end them on a login screen.
export function denyCatalogAccess(
  viewerId: string | null,
  fromPath: string
): never {
  if (viewerId) {
    redirect("/catalog");
  }
  redirect(`/sign-in?next=${encodeURIComponent(fromPath)}`);
}
