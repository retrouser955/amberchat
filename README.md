# AmberChat

AmberChat is a fully peer to peer messaging (d)app that uses GunDB to handle data store. Data is shared by peers through the use of WebRTC and some backups are stored on the relay servers. Messages sent through AmberChat are encrypted using GunDB's SEA API which implements Diffie-Hellman key exchange protocol.

# Running the app

You need to set up a relay server in order to handle communication between peers and backups.

```js
const express = require("express");
const http = require("http");
const Gun = require("gun");

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);

app.use(Gun.serve);

app.get("/time", (_, res) => {
    res.json({
        time: Date.now()
    })
})

Gun({
    web: httpServer
})

httpServer.listen(PORT, () => {
    console.log(`Gun relay listening on http://localhost:${PORT}/gun`);
});
```

That is the minimal version. A deployable version with CORS, a `/health`
endpoint, Docker support and free-hosting notes lives in
[`relay/`](relay/README.md):

```bash
cd relay && npm install && npm start
```

Then clone this repo and run `yarn install` and `yarn dev` to start the app.

## Configuration

Copy `.env.example` to `.env` and point the app at your relay:

```bash
PUBLIC_GUN_RELAY=http://localhost:3000/gun
```

Multiple relays can be comma-separated:

```bash
PUBLIC_GUN_RELAY=https://relay-one.example.com/gun,https://relay-two.example.com/gun
```

If `PUBLIC_GUN_RELAY` is not set, the app defaults to `http://localhost:3000/gun`.

## Deploying the frontend

The SvelteKit app can be deployed to Vercel. Set `PUBLIC_GUN_RELAY` in the
Vercel project's environment variables, for example:

```bash
PUBLIC_GUN_RELAY=https://amber-relay.onrender.com/gun
```

The relay is deployed separately (see `relay/README.md` and `render.yaml`).
When running on Vercel, `svelte.config.js` selects `@sveltejs/adapter-vercel`
automatically.

## Voice and video calls

Calls use WebRTC for media and Gun for signaling. Offer, answer, and ICE-candidate
signals are encrypted with the two users' SEA shared secret, and incoming calls
are rejected unless the caller is in your `friends` list.

Both DM and call channels use an opaque channel ID derived by hashing the ECDH
shared secret, so the public Gun paths do not expose which two users are talking.
DM index records are encrypted as well.

STUN is configured by default. For reliable calls behind strict NATs or corporate
firewalls, add a TURN server:

```bash
PUBLIC_TURN_URL=turn:turn.example.com:3478
PUBLIC_TURN_USERNAME=user
PUBLIC_TURN_CREDENTIAL=password
```