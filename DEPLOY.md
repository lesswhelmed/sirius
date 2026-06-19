# Deploying sirius to production (lesswhelmed.com)

Production runs on the shared Linode server alongside other apps. The web app
(`apps/web`) and the ingest worker (`apps/worker`) both run under PM2 from a
single git checkout, loading the repo-root `.env`. Caddy terminates TLS and
reverse-proxies `lesswhelmed.com` to the web app's localhost port.

## Production identity

| Property  | Value                                                             |
| --------- | ----------------------------------------------------------------- |
| Domain    | `lesswhelmed.com`                                                 |
| Server    | `172.239.45.200` (SSH user `deploy`, key `~/.ssh/id_copt_dev_v1`) |
| App dir   | `/home/deploy/apps/sirius`                                        |
| Data dir  | `/home/deploy/data/sirius`                                        |
| Web port  | `3003` (3000=copt-dev, 6940=botanical-bros are taken)             |
| PM2 procs | `sirius-web`, `sirius-worker`                                     |

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

2. **System packages (ffmpeg)** — the worker shells out to `ffmpeg` to extract a
   poster frame from uploaded videos (`apps/worker/src/pipeline/video-thumbnail.ts`).
   It degrades gracefully without it (video thumbnails are simply skipped), so this
   is not strictly required, but install it so video posts get covers:

   ```sh
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200 "\
     sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq && \
     sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg && \
     ffmpeg -version | head -1"
   ```

   `deploy.sh` also ensures ffmpeg on every run (idempotent — it only touches apt
   when ffmpeg is missing), so a fresh host is covered by the first deploy too. If
   ffmpeg lives somewhere off `PATH`, set `FFMPEG_PATH=/abs/path/to/ffmpeg` in `.env`.

3. **Directories**

   ```sh
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200 "\
     mkdir -p /home/deploy/apps/sirius \
              /home/deploy/data/sirius/ingest-staging \
              /home/deploy/logs"
   ```

4. **Postgres database/user** (run on the server as the postgres superuser).
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

5. **Clone the repo**

   ```sh
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200 "\
     cd /home/deploy/apps && git clone <repo-url> sirius"
   ```

6. **Server `.env`** — copy your filled-in local `.env.production` to the
   server as the app `.env`:

   ```sh
   scp -i ~/.ssh/id_copt_dev_v1 .env.production \
     deploy@172.239.45.200:/home/deploy/apps/sirius/.env
   ```

   Confirm the server paths in it are correct:
   `INGEST_STAGING_DIR=/home/deploy/data/sirius/ingest-staging`,
   `SIGHT_IMAGE_DIR=/home/deploy/apps/sirius/apps/web/public/sight`,
   `SOCIAL_IMAGE_DIR=/home/deploy/apps/sirius/apps/web/public/social`.

7. **Caddy site block** — the canonical config is version-controlled at
   [`infra/caddy/Caddyfile`](infra/caddy/Caddyfile) (apply instructions in
   [`infra/caddy/README.md`](infra/caddy/README.md)). Copy it to
   `/etc/caddy/Caddyfile`.

   Besides reverse-proxying to Next on :3003, it has a dedicated block that
   serves `/sight/*` and `/social/*` from disk via `file_server` (rooted at
   `.../apps/web/public`). This is **required**: the worker writes post media
   there at runtime, and `next start` only serves `public/` files that existed
   at build time — without this block (or the in-app `app/{sight,social}` route
   handlers) those images 404. Keep the `file_server` root in sync with
   `SIGHT_IMAGE_DIR`/`SOCIAL_IMAGE_DIR` above.

   Apply:

   ```sh
   scp -i ~/.ssh/id_copt_dev_v1 infra/caddy/Caddyfile deploy@172.239.45.200:/tmp/Caddyfile
   ssh -i ~/.ssh/id_copt_dev_v1 deploy@172.239.45.200
   sudo cp /tmp/Caddyfile /etc/caddy/Caddyfile
   sudo caddy fmt --overwrite /etc/caddy/Caddyfile
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

8. **First deploy** (on the server, starts both PM2 processes):

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

This pushes the branch, runs `./deploy.sh` on the server (ensure ffmpeg → pull →
install → prisma generate → migrate → build into `.next-builds/<id>` → symlink
`current` → PM2 reload → `pm2 save` → prune to 3 builds → `pm2 status`), then verifies
`https://lesswhelmed.com` returns HTTP 200. The ffmpeg step is idempotent — it
only touches apt when ffmpeg is missing (see "System packages" below).

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
