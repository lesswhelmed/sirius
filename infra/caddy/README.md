# Caddy config

`Caddyfile` here is the **source of truth** for the production reverse proxy
(`lesswhelmed.com`). The live file is `/etc/caddy/Caddyfile` on the deploy host
(`deploy@172.239.45.200`). Caddy is system-level and editing `/etc/caddy`
requires `sudo`, so applying this is a **manual step** — it is intentionally NOT
part of `deploy.sh` (which runs unprivileged as the `deploy` user).

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

## Apply

```sh
# from your machine — copy the repo's canonical config up:
scp -i ~/.ssh/id_copt_dev_v1 infra/caddy/Caddyfile deploy@172.239.45.200:/tmp/Caddyfile

# on the server:
ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200
sudo cp /tmp/Caddyfile /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Verify

```sh
# a runtime-written media file should return 200 + image content-type:
curl -sI https://lesswhelmed.com/sight/<batch>/1.jpg | head -n 5
```
