import http from "node:http";
import cors from "cors";
import express from "express";
import Gun from "gun";

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.GUN_DATA_DIR || "radata";

// Browser-side allowlist. WebSockets are NOT subject to CORS: the browser sends
// the Origin header but does not enforce anything, so the check has to happen
// here, on the upgrade request.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
	.split(",")
	.map((origin) => origin.trim().replace(/\/$/, ""))
	.filter(Boolean);

// Shared secret for everyone who is not a browser, e.g.
// PUBLIC_GUN_RELAY=https://relay.example.com/gun?token=...
const RELAY_TOKEN = process.env.RELAY_TOKEN || "";

function isAllowed(req) {
	if (RELAY_TOKEN) {
		const token = new URL(req.url || "/", "http://relay").searchParams.get("token");
		if (token !== RELAY_TOKEN) return false;
	}

	if (ALLOWED_ORIGINS.length) {
		const origin = req.headers.origin;
		// No Origin header means a non-browser client (curl, another relay,
		// a scanner). Those are covered by RELAY_TOKEN instead.
		if (origin && !ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ""))) return false;
	}

	return true;
}

const app = express();
app.disable("x-powered-by");

// A Gun relay is public by design: every peer can read/write any soul, and
// AmberChat protects messages with SEA encryption instead. So allow any
// origin. (Gun's own middleware also sets Allow-Origin: * on /gun.)
app.use(
	cors({
		origin: "*",
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
		exposedHeaders: ["Content-Length"],
		maxAge: 86400,
		// The client sends no cookies or Authorization headers, so "*" is safe.
		credentials: false,
	}),
);

app.get("/health", (_req, res) => {
	res.json({ ok: true, uptime: Math.round(process.uptime()), now: Date.now() });
});

app.get("/", (_req, res) => {
	res.type("text/plain").send("AmberChat Gun relay. Point PUBLIC_GUN_RELAY here with /gun appended.\n");
});

// Gun's XHR/JSONP fallback also arrives as a normal HTTP request to /gun, so
// gate it with the same rules as the WebSocket upgrade.
app.use((req, res, next) => {
	if (!req.path.startsWith("/gun")) return next();
	if (isAllowed(req)) return next();
	res.status(403).json({ error: "forbidden" });
});

const server = http.createServer(app);

// Gun's own middleware handles /gun (WebSocket upgrade + XHR fallback).
// Mounted after cors() so the fallback transport gets the CORS headers.
app.use(Gun.serve);

const gun = Gun({
	web: server,
	peers: [], // this process is the relay; do not dial other relays
	localStorage: false,
	radisk: true,
	file: DATA_DIR, // ignored on hosts with an ephemeral disk (Render/Koyeb free)
	multicast: false, // no UDP multicast peer discovery on a hosted relay
	axe: false, // no WebRTC peer discovery either
	ws: {
		path: "/gun",
		// Runs before the WebSocket handshake completes; returning 403 means the
		// socket never becomes a Gun peer. `length === 2` selects the callback
		// form, which is what lets us send a 403 instead of ws's default 401.
		verifyClient: (info, done) => {
			if (isAllowed(info.req)) return done(true);
			console.warn("blocked relay client", info.req.headers.origin || "(no origin)");
			done(false, 403, "Forbidden");
		},
	},
});

server.on("error", (error) => {
	console.error("relay failed to start:", error);
	process.exit(1);
});

server.listen(PORT, () => {
	console.log(`Gun relay listening on :${PORT} (path /gun)`);
	console.log(`data dir: ${DATA_DIR}`);
});

function shutdown(signal) {
	console.log(`${signal} received, closing relay`);
	server.close(() => process.exit(0));
	// radisk timers can keep the event loop alive; don't wait forever.
	setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Keep a reference so pruning tools don't consider it unused.
export { gun };
