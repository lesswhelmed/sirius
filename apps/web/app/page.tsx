import { redirect } from "next/navigation";
import { getSessionOrNull } from "../lib/session";

export default async function Home() {
  const session = await getSessionOrNull();
  redirect(session ? "/ingest" : "/sign-in?next=/ingest");
}
