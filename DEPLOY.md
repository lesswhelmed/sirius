# Deploying sirius to production (lesswhelmed.com)

Production runs on the shared Linode server alongside other apps. The web app
(`apps/web`) and the ingest worker (`apps/worker`) both run under PM2 from a
single git checkout, loading the repo-root `.env`. Caddy terminates TLS and
reverse-proxies `lesswhelmed.com` to the web app's localhost port.

## Production identity

| Property | Value |
| --- | --- |
| Domain | `lesswhelmed.com` |
| Server | `172.239.45.200` (SSH user `deploy`, key `~/.ssh/id_copt_dev_v1`) |
| App dir | `/home/deploy/apps/sirius` |
| Data dir | `/home/deploy/data/sirius` |
| Web port | `3003` (3000=copt-dev, 6940=botanical-bros are taken) |
| PM2 procs | `sirius-web`, `sirius-worker` |

Redis is present on the server but **not used** by this app — the ingest queue
is Postgres-backed (`IngestSubmission`). No Redis configuration is required.

## One-time local setup

```sh
bun run env:production   # creates .env.production (never overwrites an existing one)
```

Then edit `.env.production` and replace every `<...>` placeholder:
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`GEMINI_API_KEY` (and optional `APIFY_TOKEN` / `YOUTUBE_DATA_API_KEY`).
`INGEST_TOKEN` and `REVALIDATE_TOKEN` are pre-generated; rotate if you wish.

`.env.production` is gitignored and is the local mirror of the server `.env`.

## One-time server setup

1. **DNS** — point `lesswhelmed.com` A record at `172.239.45.200`.

2. **Directories**

   ```sh
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200 "\
     mkdir -p /home/deploy/apps/sirius \
              /home/deploy/data/sirius/ingest-staging \
              /home/deploy/logs"
   ```

3. **Postgres database/user** (run on the server as the postgres superuser).
   Use a strong password matching the one in `DATABASE_URL`.

   ```sh
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200
   sudo -u postgres psql <<'SQL'
   CREATE USER sirius WITH PASSWORD '<password>';
   CREATE DATABASE sirius OWNER sirius;
   GRANT ALL PRIVILEGES ON DATABASE sirius TO sirius;
   SQL
   ```

   Prisma migrations run as this user via `bun run db:migrate:deploy` during
   deploy, so ownership of the `sirius` database is sufficient.

4. **Clone the repo**

   ```sh
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200 "\
     cd /home/deploy/apps && git clone <repo-url> sirius"
   ```

5. **Server `.env`** — copy your filled-in local `.env.production` to the
   server as the app `.env`:

   ```sh
   scp -i ~/.ssh/id_copt_dev_v1 .env.production \
     deploy@172.239.45.200:/home/deploy/apps/sirius/.env
   ```

   Confirm the server paths in it are correct:
   `INGEST_STAGING_DIR=/home/deploy/data/sirius/ingest-staging`,
   `SIGHT_IMAGE_DIR=/home/deploy/apps/sirius/apps/web/public/sight`,
   `SOCIAL_IMAGE_DIR=/home/deploy/apps/sirius/apps/web/public/social`.

6. **Caddy site block** — add to `/etc/caddy/Caddyfile`:

   ```caddyfile
   lesswhelmed.com {
       reverse_proxy 127.0.0.1:3003 {
           header_up X-Real-IP {remote_host}
           header_up X-Forwarded-Host {host}
       }

       header {
           X-Frame-Options "SAMEORIGIN"
           X-Content-Type-Options "nosniff"
           X-XSS-Protection "1; mode=block"
           Strict-Transport-Security "max-age=31536000; includeSubDomains"
           -Server
       }

       @static path /_next/static/*
       handle @static {
           header Cache-Control "public, immutable, max-age=31536000"
           reverse_proxy 127.0.0.1:3003
       }

       encode gzip zstd
   }
   ```

   Then:

   ```sh
   sudo caddy fmt --overwrite /etc/caddy/Caddyfile
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

7. **First deploy** (on the server, starts both PM2 processes):

   ```sh
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200 \
     "cd /home/deploy/apps/sirius && ./deploy.sh"
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200 "pm2 save"
   ```

## Routine deploys

From your local checkout, after committing to `main`:

```sh
bun run deploy
```

This pushes the branch, runs `./deploy.sh` on the server (pull → install →
prisma generate → migrate → build into `.next-builds/<id>` → symlink
`current` → PM2 reload → `pm2 save` → prune to 3 builds → `pm2 status`), then verifies
`https://lesswhelmed.com` returns HTTP 200.

## Pre-deploy local checks

```sh
bun install
bun run db:generate
bun run check-types
bun run lint
bun run build
```

## Verification (server)

```sh
pm2 status                                   # sirius-web + sirius-worker online
curl -sI http://127.0.0.1:3003               # local web response
curl -sI https://lesswhelmed.com             # public TLS + 200
pm2 logs sirius-web --lines 100
pm2 logs sirius-worker --lines 100
```

End-to-end: submit a URL/note (web composer or mobile), confirm the
`IngestSubmission` row moves `pending → processing → completed` and a post
appears in the catalog. With `REVALIDATE_TOKEN` + `WEB_REVALIDATE_URL` set, the
worker invalidates the web cache immediately after writing.

## Rollback

Fast (no rebuild):

```sh
cd /home/deploy/apps/sirius/apps/web/.next-builds
ls -1dt */                       # list builds newest-first
ln -sfn <previous-build-id> current
pm2 reload sirius-web            # re-serve the now-current symlink
```

## Mobile release (Expo / EAS)

The mobile app already targets production: `apps/mobile/eas.json` sets
`EXPO_PUBLIC_AUTH_BASE_URL=https://lesswhelmed.com` for both `preview` and
`production`. The web app must be live first, and the server `.env` **must**
include `AUTH_TRUSTED_ORIGINS=siriusapp://` (Better Auth rejects the Expo
deep-link callback otherwise).

```sh
bun --cwd apps/mobile build:preview   # internal build to verify prod connectivity
bun --cwd apps/mobile build:prod      # store build (clean committed tree required)
bun --cwd apps/mobile update:prod     # OTA JS push after a native release
```

Remaining store prerequisites:
- iOS: backfill `submit.production.ios.ascAppId` in `apps/mobile/eas.json` after
  the first `eas submit` creates the App Store Connect record.
- Android: add the untracked `apps/mobile/google-play-service-account.json`.

Verify on the preview build: sign up / sign in, then submit a note, URL, and
image batch — all should hit `https://lesswhelmed.com` and show up in the
queue and library.
