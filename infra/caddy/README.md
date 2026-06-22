# Caddy config

`Caddyfile` here is the canonical copy of **two site blocks**: the
**`lesswhelmed.com`** web app and the **`mcp.lesswhelmed.com`** MCP corpus server.
The live `/etc/caddy/Caddyfile` on the deploy host (`deploy@172.239.45.200`) is
**shared** and ALSO serves `copt.dev`, `www.copt.dev`, and `brotanicaldistro.com`.

> ⚠️ **Do not `cp` this file over the live one.** It contains only the
> `lesswhelmed.com` block; overwriting `/etc/caddy/Caddyfile` would delete the
> three other sites and take them down. Apply it by **merging** — swap just the
> `lesswhelmed.com { … }` block, leaving the others byte-for-byte untouched (steps
> below).

Editing `/etc/caddy` needs `sudo`, so this is a **manual step** — intentionally
NOT part of `deploy.sh` (which runs unprivileged as the `deploy` user).

## What it does

Three mutually-exclusive route groups:

1. `/_next/static/*` → Next.js, with `immutable` caching (hashed build assets).
2. `/sight/*` and `/social/*` → **served from disk** by `file_server`, rooted at
   `/home/deploy/apps/sirius/apps/web/public`. The ingest worker writes post
   images here at runtime; `next start` only serves `public/` files that existed
   at build time, so these would otherwise 404. (The in-app route handlers at
   `apps/web/app/{sight,social}/[...path]/route.ts` serve the same bytes in dev
   and as the `next/image` optimizer's internal-fetch target.)
3. everything else → the Next.js server on `127.0.0.1:3003`.

Keep the `file_server` root in sync with `SIGHT_IMAGE_DIR` / `SOCIAL_IMAGE_DIR`
in `.env.production` (both currently under `.../apps/web/public`).

A **second, separate** `mcp.lesswhelmed.com` block reverse-proxies the MCP corpus
server (`apps/mcp`, PM2 `sirius-mcp`) on `127.0.0.1:3005`. It has no static
assets or media — the whole surface is the stateless MCP Streamable-HTTP
endpoint, authenticated per-request with a user-issued API key. `mcp.lesswhelmed.com`
needs its own DNS A record pointing at the deploy host so Caddy can issue a cert.

## One-time prerequisite: let Caddy read the media

Caddy runs as the **`caddy`** user, but the media lives under `/home/deploy`,
which is `0750` (`deploy:deploy`) and not traversable by other users — so a naïve
`file_server` returns **403**. Add `caddy` to the `deploy` group once (the group
already has `r-x` on `/home/deploy` and `rwx` on the media dirs):

```sh
ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200
sudo usermod -aG deploy caddy
sudo systemctl restart caddy   # group change needs a RESTART, not just reload
id caddy                       # confirm: groups=…,deploy
```

## Apply (MERGE — never overwrite)

```sh
ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200

# back up the live (shared) config first
sudo cp -n /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak

# replace ONLY the sirius blocks. They are the last two blocks (lesswhelmed.com
# then mcp.lesswhelmed.com), so: keep every line before the first one, then
# append BOTH canonical blocks from this repo. (Paste the repo's
# infra/caddy/Caddyfile from the `lesswhelmed.com {` line to EOF — i.e. both the
# lesswhelmed.com and mcp.lesswhelmed.com blocks — into /tmp/sirius.blocks.)
awk '/^lesswhelmed\.com \{/{exit} {print}' /etc/caddy/Caddyfile > /tmp/merged.Caddyfile
cat /tmp/sirius.blocks >> /tmp/merged.Caddyfile

# sanity: all five sites must still be present
for s in 'copt.dev {' 'www.copt.dev {' 'brotanicaldistro.com {' 'lesswhelmed.com {' 'mcp.lesswhelmed.com {'; do
  grep -qF "$s" /tmp/merged.Caddyfile || echo "MISSING: $s"
done

# diff should show ONLY the lesswhelmed.com block changing
diff -u /etc/caddy/Caddyfile /tmp/merged.Caddyfile

sudo cp /tmp/merged.Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

## Verify

```sh
# media served from disk by Caddy: 200, image content-type, NO x-powered-by:
curl -sI https://lesswhelmed.com/social/<file>.jpg | head -n 5

# the other shared sites must still be up:
for u in https://copt.dev https://brotanicaldistro.com https://lesswhelmed.com; do
  curl -s -o /dev/null -w "$u %{http_code}\n" "$u"; done
```
