// Best-effort cache invalidation: after the worker writes a post, ping the web
// app's internal revalidate endpoint so cached post bodies/lists refresh
// immediately. No-ops silently when WEB_REVALIDATE_URL / REVALIDATE_TOKEN are
// unset (e.g. local runs), so the worker never fails on this.
export async function revalidatePost(slug: string): Promise<void> {
  const url = process.env.WEB_REVALIDATE_URL?.trim();
  const token = process.env.REVALIDATE_TOKEN?.trim();
  if (!url || !token) {
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ slug }),
    });
    if (!res.ok) {
      console.warn(
        `[revalidate] ${url} responded ${res.status} for slug=${slug}`
      );
    }
  } catch (err) {
    console.warn(`[revalidate] failed for slug=${slug}:`, err);
  }
}
