# Nest Headless Snapshot — MOBTrips fork

A security-maintained fork of [rapartlu/nest-headless-snapshot](https://github.com/rapartlu/nest-headless-snapshot), based on upstream 1.34.0. The upstream MIT license and attribution are retained.

This app captures real still frames from Nest WebRTC cameras on Home Assistant OS. Home Assistant builds and manages its container; manual Docker administration is unnecessary.

## Changes in 1.34.0-mob.2

- Bearer authentication for **all** image, status, archive and feature APIs, including loopback callers. Only `GET /health` is public. Chromium's `/blank` and handover administration are socket-loopback only.
- An explicit camera allowlist, validated before camera capture, filesystem access and HA signaling. An empty list allows no cameras.
- Safe request parsing and asynchronous error containment.
- HTTPS event delivery for secure HA WebSocket configurations.
- Both the snapshot API token and HA token are redacted from startup configuration logs.
- No host port published by default; snapshots default to a private HA configuration subfolder.
- Node 22 and updated Puppeteer dependencies. Optional vision and speech remain disabled by default.

## Install on Home Assistant OS

1. Add `https://github.com/MOBTrips/nest-headless-snapshot` in **Settings → Apps → Install app → Repositories**.
2. Install **Nest Headless Snapshot (MOBTrips)**.
3. Set `api_token` to a separately generated random secret. Do not reuse your HA access token. Add the permitted camera entity IDs to `allowed_cameras`.
4. Keep the Network host port empty. Leave `enable_vision` and `enable_speech` false for capture-only use. Start the app.

Configuration example (replace the placeholder before starting):

```yaml
api_token: REPLACE_WITH_A_RANDOM_SECRET
allowed_cameras:
  - camera.front_door
enable_vision: false
enable_speech: false
```

Callers on the internal HA app network must send `Authorization: Bearer <api_token>`. The app hostname depends on the repository ID; obtain it from the installed app rather than assuming the upstream hostname.

```yaml
rest_command:
  nest_capture:
    url: "http://APP_HOSTNAME:8098/snapshot/front_door?fresh=1&format=json"
    method: get
    headers:
      Authorization: !secret nest_snapshot_authorization
    timeout: 45
```

Store the complete `Bearer <api_token>` value in HA secrets, not in this repository. Never place a token in a URL. Stop the app before rotating its token, update callers, then restart.

## Images and privacy

The default latest JPEG path inside HA Core is `/config/nest_snapshots/<camera>.jpg`. The app sees the same config share at `/homeassistant/nest_snapshots` on HA OS. Use the `file` returned by the capture JSON with the appropriate HA Core path translation.

These files are **not** placed in HA's public `/local` directory by default. Explicitly configuring `out_dir` or `samples_dir` under `www` makes those copies subject to HA's static-file exposure independently of this API's token. Archiving is off by default. Old snapshots from an existing upstream installation are not removed or migrated automatically.

The app still receives HA API authority and a read/write HA configuration mount. Unpublishing the host port reduces LAN exposure; other trusted apps on the internal app network may still reach its listener, where the bearer token remains required. Do not expose the listener to the Internet.

Optional speech/identity features have additional privacy and storage implications, including pending face/voice samples; keep them off unless deliberately configured. See the upstream detailed guide for feature semantics; the security requirements above override its older unauthenticated examples.

## Development and validation

From `nest_headless/app`, use Node 22.12 or later:

```sh
npm ci --ignore-scripts
npm run test:security
npm run test:capture
```

The full optional vision suite additionally needs the packages in `features/vision`. Capture-only tests explicitly skip the five tests that require native vision packages; they do not claim those features were verified. `nest_headless/test/loopback.js` checks browser video capture against a local synthetic WebRTC sender when Chromium is available.

Standalone Compose is optional; its published port binds only to the host's loopback address. Configure both `API_TOKEN` and JSON `ALLOWED_CAMERAS` in the environment. A native launch through either `nest_headless/run.sh` or the compatibility `nest_headless/server.js` uses the same maintained implementation.

Historical upstream overview: [UPSTREAM_README.md](UPSTREAM_README.md). Detailed optional features: [nest_headless/DOCS.md](nest_headless/DOCS.md). Those guides include older public-output/unauthenticated examples; adapt them to this fork's requirements.
