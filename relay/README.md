# AmberChat relay

Standalone GunDB relay for AmberChat. The SvelteKit app talks to it at `/gun`;
everything else (CORS, health checks, shutdown handling) exists so this can sit
behind a managed host.

## Run locally

```bash
cd relay
npm install
npm start          # http://localhost:3000/gun
```

Then in the app's `.env`:

```bash
PUBLIC_GUN_RELAY=http://localhost:3000/gun
```

Note the `/gun` suffix: `Gun({ peers })` uses the URL as given, and the relay
only answers on `/gun`.

## Endpoints

| Path      | Purpose                                                        |
| --------- | -------------------------------------------------------------- |
| `/gun`    | Gun wire protocol (WebSocket upgrade + XHR fallback).          |
| `/health` | `{ ok, uptime, now }` — use this for uptime checks / warm-ups. |
| `/`       | Plain-text hint for humans who open the URL.                    |

## CORS (and why it does not protect the relay)

The server runs the standard `cors` middleware before `Gun.serve`, so preflight
`OPTIONS` requests and the XHR fallback get:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
Access-Control-Max-Age: 86400
```

`*` for `Allow-Origin` is fine and does not weaken anything: **CORS does not
apply to WebSockets.** The browser sends `Origin` on the upgrade request but does
not check the response, so a CORS header can never stop another site from talking
to your relay. Only a server-side check on the upgrade can, which is what
`ALLOWED_ORIGINS` below does.

## Blocking everyone except your demo

Set one or both of these:

```bash
# Only pages served from these origins may connect (browser enforcement).
ALLOWED_ORIGINS=https://amber-demo.vercel.app,http://localhost:5173

# Shared secret, appended to the relay URL.
RELAY_TOKEN=some-long-random-string
```

`ALLOWED_ORIGINS` is enforced in `verifyClient`, which runs **before** the
WebSocket handshake completes, so a rejected socket never becomes a Gun peer. The
same check guards Gun's XHR fallback on `/gun`; `/health` stays open so uptime
checks keep working.

With `RELAY_TOKEN` set, the app's URL becomes:

```bash
PUBLIC_GUN_RELAY=https://relay.example.com/gun?token=some-long-random-string
```

Gun keeps the query string when it opens the socket, so this needs no app change.

### What this does and does not buy you

- It stops scanners, other Gun apps that find or copy your relay URL, and any
  random website from using it. For a tiny demo relay that is the usual problem,
  and it is enough to stay inside bandwidth/CPU limits.
- `ALLOWED_ORIGINS` only constrains browsers. `curl`, a Node script, or another
  Gun relay can send no `Origin` at all, which is why missing `Origin` is allowed
  and `RELAY_TOKEN` exists for those clients.
- `RELAY_TOKEN` is a `PUBLIC_` variable, so it ships inside your frontend JS
  bundle. Anyone who opens devtools on the demo can read it. Treat it as an
  anti-abuse gate, not authentication.
- Real authentication would mean the relay only accepts sockets from users who
  prove they own a keypair — that needs app changes (the client would have to
  authenticate to the relay before Gun's messages flow) and is out of scope here.
- On Render, no card means going over the free bandwidth suspends the service for
  the rest of the month instead of billing you, so a mistake cannot cost money.

A public relay is not a confidentiality problem by the way: AmberChat encrypts
message content with SEA, and the relay only ever sees ciphertext and opaque
channel IDs. What a stranger can do is consume your quota and store junk.

## Configuration

| Variable         | Default   | Notes                                                                  |
| ---------------- | --------- | ---------------------------------------------------------------------- |
| `PORT`           | `3000`    | Most hosts inject this.                                                |
| `GUN_DATA_DIR`   | `radata`  | Radisk directory. Mount a persistent volume here for cross-device login. |
| `ALLOWED_ORIGINS`| *(empty)* | Comma-separated browser origins, e.g. `https://amber.vercel.app`.       |
| `RELAY_TOKEN`    | *(empty)* | Shared secret, passed as `?token=…` on the relay URL.                  |
| `NODE_ENV`       | —         | Set to `production` on managed hosts.                                   |

## Deploying for a demo

### Render (easiest, no card)

1. Push this repo to GitHub.
2. Render → **New → Blueprint**, pick the repo. `render.yaml` in the repo root
   creates a free web service with **Root Directory** `relay`.
   (Manual alternative: **New → Web Service**, root directory `relay`,
   build `npm ci`, start `npm start`, plan **Free**.)
3. Set the app's `PUBLIC_GUN_RELAY` to `https://<service>.onrender.com/gun`.

Free-tier behaviour that matters for a demo:

- It spins down after **15 minutes without inbound traffic** and takes ~1 minute
  to wake. Open the `/health` URL about a minute before you demo, or keep one
  client connected (Gun's WebSocket heartbeats count as traffic).
- The filesystem is **ephemeral** and free instances may restart at any time.
  This is **not** fine for account login on a new device: a phone and a PC do
  not share browser storage, and the relay is the only shared copy of the user
  account until that device has synced it. If the relay restarts before the PC
  logs in, the account is gone and login fails with "Wrong user or password."
  See [Persistence](#persistence) for the fix.
- 750 instance hours per workspace per month; always-on costs ~730 hours, so one
  service fits, but Render's terms say free instances are not for production.

If you want an always-on free box instead, **Northflank Sandbox** gives 2
always-on services with no sleeping (card required for identity verification),
and **Oracle Cloud Always Free** gives 2 Ampere OCPUs / 12 GB RAM with no sleep
(card required, instances idle for a week may be reclaimed).

## Persistence

`localStorage: false` in `relay/index.js` only disables browser `localStorage`;
it does **not** disable disk storage. The relay runs Gun's radisk store at
`GUN_DATA_DIR` (default `radata`).

For login from a new device, that directory must survive relay restarts. A new
PC has no account data in its browser, so the relay is the only source for the
account record. If the relay restarts with an empty filesystem, the account is
gone and login fails.

### Fly.io

Create a volume once, then mount it:

```bash
fly volumes create amber_data --region syd --size 1 -a amberchat-relay-berry
```

Add to `relay/fly.toml`:

```toml
[mounts]
  source = "amber_data"
  destination = "/data"

[env]
  GUN_DATA_DIR = "/data"
```

Keep the relay at **one machine**. Radisk files are not safe for multiple
processes writing to separate local disks.

### Render

Render free instances have an ephemeral filesystem. To keep accounts, use a
paid instance with a persistent disk mounted at `/var/data`, then set:

```bash
GUN_DATA_DIR=/var/data
```

Render disks are not available on the free plan. If you stay on free, use it
for ephemeral demo messages only, not for cross-device account login.

### Docker / VPS

```bash
cd relay
docker build -t amber-relay .
docker run -p 3000:3000 \
  -v amber-relay-data:/data \
  -e GUN_DATA_DIR=/data \
  amber-relay
```

Set the container port from `PORT` and put TLS in front of it if the app is
served over HTTPS — a page on `https://` cannot connect to `ws://`.

`/health` reports `dataDir` and `dataDirConfigured` so you can confirm the relay
is using the mounted path.

### Things that do *not* work

Vercel, Netlify, Cloudflare Pages/Workers and other serverless platforms cannot
host this: a Gun relay needs a long-lived Node process and WebSocket upgrades.
They are fine for the SvelteKit **frontend** though.

## Demo checklist

- [ ] App is served over HTTPS and the relay URL uses `https://…/gun`
      (mixed content breaks WebSockets).
- [ ] Set `RELAY_TOKEN` on the relay and `?token=…` in `PUBLIC_GUN_RELAY`, and
      `ALLOWED_ORIGINS` to the frontend's origin.
- [ ] `/health` answers before you start.
- [ ] Two browser profiles (not two tabs — Gun shares `sessionStorage` per
      origin, and you want two separate accounts).
- [ ] `PUBLIC_GUN_RELAY` set on the frontend host, then rebuild/redeploy.
