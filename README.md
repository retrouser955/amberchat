# AmberChat

AmberChat is a fully peer to peer messaging (d)app that uses GunDB to handle data store. Data is shared by peers through the use of WebRTC and some backups are stored on the relay servers. Messages sent through AmberChat are encrypted using GunDB's SEA API which implements Diffie-Hellman key exchange protocol.

# Running the app

You need to set up a relay server in order to handle communication between peers and backups.

```js
const express = require("express");
const Gun = require("gun");

const PORT = process.env.PORT || 3000;

const app = express();

app.use(Gun.serve);

app.get("/time", (_, res) => {
    res.json({
        time: Date.now()
    })
})

Gun({
    web: httpServer
})
```

Install both express and gun and run it with `node index.js`.

Then, you may clone this repo and run `yarn` and `yarn dev` to start the app.