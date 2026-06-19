# Wireless Android over Wi-Fi

## Standalone APK (no Metro) — `mobile:apk`

The reliable path: compile a self-contained release APK (JS bundle embedded, signed with
the debug key) and install + launch it on the phone over wireless adb. Points at
production (`https://lesswhelmed.com`) by default, so no dev server / `adb reverse` /
cleartext config — install and it runs.

```sh
bun run mobile:apk                       # discover phone, build, install, launch
bun run mobile:apk 192.168.50.89:44545   # specific ip:port (after a phone reboot)

NO_BUILD=1 bun run mobile:apk            # reinstall the last-built APK (skip gradle)
EXPO_PUBLIC_AUTH_BASE_URL=http://localhost:3000 bun run mobile:apk   # other backend
```

APK output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. The first
build compiles the llama.rn native bridge from scratch (several minutes); later builds are
cached. Edit code → re-run `mobile:apk` → it rebuilds and reinstalls.

---

## Dev-client mode (Metro live reload) — `mobile:wireless`

Run the Sirius mobile **dev client** on a physical Android phone over Wi-Fi via adb
wireless debugging — no USB cable, no LAN cert trust. Ported from PenguinSlide's
`android-libgdx/` wireless scripts and adapted to the Expo dev client.

How it reaches the backend: `wireless-run.sh` sets up `adb reverse` so the phone's
`localhost:3000` (web/API) and `localhost:8081` (Metro) tunnel back to this host over the
same wireless adb link. The app talks to `http://localhost:3000` — already an
auth-trusted origin — so there's no portless `sirius.local` / CA-trust step (that path
still exists via `bun run dev:proxy`; this is the cable-free, cert-free alternative).

## One-time setup

1. Phone: **Settings → Developer options → Wireless debugging → ON**.
2. Pair once (only ever needed once per phone):
   ```sh
   ~/Android/Sdk/platform-tools/adb pair <ip>:<pairPort> <code>
   ```
   (the IP, pairing port, and code are under "Pair device with pairing code").

## Each session

```sh
# 1. host dev stack (web + worker) in one terminal — NO portless/sudo, web on :3000:
bun run dev:wireless:host

# 2. deploy + run on the phone in another terminal (from repo root):
bun run mobile:wireless            # pull latest, then build + install + launch + Metro
# or, without the git pull:
bun run mobile:wireless:run

# after a phone reboot the connect port rotates — pass the new one once:
bun run mobile:wireless:run 192.168.50.89:43027
```

- `NO_BUILD=1 bun run mobile:wireless:run` — skip the gradle rebuild, just relaunch the
  installed dev client (and re-establish the reverse tunnels).
- `bun run mobile:find-phone` — print the phone's current live `ip:port` (TCP-verified);
  `--list` to see all candidates.

## Scripts

| Script             | Does                                                                 |
| ------------------ | ------------------------------------------------------------------- |
| `find-phone.sh`    | Discover the wireless-debugging endpoint (avahi/adb mDNS + last-used) |
| `wireless-run.sh`  | Connect → `adb reverse` 3000/8081 → `verify:native-ai` → `expo run:android` |
| `dev-wireless.sh`  | `git pull --rebase --autostash`, then `wireless-run.sh`              |

`ANDROID_HOME` defaults to `~/Android/Sdk`; override the env if yours differs.
