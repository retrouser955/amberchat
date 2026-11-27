# AGENTS.md

## What this is

AmberChat is a client-only SvelteKit chat app backed by GunDB. There is no
application server: `src/` runs in the browser, and a separate standalone Gun
relay (`relay/`) stores and relays the graph. Direct messages are E2E encrypted
with SEA ECDH shared secrets. Group chats use an owner-managed epoch key, and
voice/video calls use WebRTC with Gun signaling (1:1 and group mesh).

## Commands

```bash
yarn install          # Yarn 4 via corepack; nodeLinker: node-modules
yarn dev              # Vite dev server
yarn build            # production build
yarn preview          # preview the build
yarn check            # svelte-kit sync + svelte-check (only automated check)
yarn check:watch      # same, in watch mode
```

- There are no tests, linter, formatter script, or CI. Run `yarn check` after
  changes. Prettier config is only `{ "useTabs": true }`, and
  `.vscode/settings.json` forces tabs; use tabs in every source file.
- `relay/` is a **separate npm project, not a Yarn workspace**:
  `cd relay && npm install && npm start` serves `http://localhost:3000/gun`.
  `relay/radata` is gitignored; never commit it.
- Real messaging requires a relay. Copy `.env.example` to `.env` and set
  `PUBLIC_GUN_RELAY` (comma-separated peers, default
  `http://localhost:3000/gun`). Calls optionally use `PUBLIC_TURN_URL`,
  `PUBLIC_TURN_USERNAME`, `PUBLIC_TURN_CREDENTIAL`.

Deployment: `svelte.config.js` picks `adapter-vercel` when `VERCEL` is set,
otherwise `adapter-auto`. `vite.config.ts` sets `ssr.noExternal: ['gun']` only
for the Vercel production build; Gun is CommonJS and externalizing it there
crashes with `ERR_INTERNAL_ASSERTION`. Do not enable that in dev, where Vite's
SSR runner has no `module` global. The relay deploys separately (`render.yaml`,
`relay/fly.toml`, `relay/Dockerfile`); see `relay/README.md`.

## Layout / entrypoints

```
src/routes/+layout.svelte        root shell: Navbar + CallOverlay + GroupCallOverlay
src/routes/chat/                 AuthGuard -> Sidebar -> DM pane, keyed by pathname
src/routes/friend-requests/      AuthGuard + invite/request UI
src/routes/profile/              avatar upload/resize, display name, bio
src/routes/groups/               list, create, join, conversation, settings
src/lib/gun/Gun.svelte.ts        Gun singleton, gunData rune, profiles, auth/logout
src/lib/gun/Channel/DMChannel.svelte.ts
src/lib/gun/Group/               group types, crypto, Group.ts, GroupChannel
src/lib/gun/User/User.ts         invites, friend requests, accept
src/lib/gun/Friends.svelte.ts    reactive friend set + canSeeAvatar()
src/lib/calls/CallManager.svelte.ts
src/lib/calls/GroupCallManager.svelte.ts
src/lib/Components/              capital C; shadcn primitives under ui/
relay/index.js                   standalone Gun relay
```

- `$lib/gun` (`src/lib/gun/index.ts`) re-exports only `DMChannel` and its
  types; import `Gun.svelte` and `User/User` directly.
- `components.json` aliases point at `$lib/Components` (capital C). There is no
  lowercase `components/` directory; use the real casing.
- `src/lib/gun/User/SEA.ts` and `src/lib/gun/Time/Time.ts` are intentionally
  empty placeholders, not accidental deletions.

## GunDB / data model

- `createGun()` is lazy: creates one `Gun({ peers })`, registers the `"auth"`
  handler, then calls `recall({ sessionStorage: true })` (handler first so a
  synchronous recall is not missed). `gunData` is a `$state` `{ user?, ready }`;
  `AuthGuard` waits for `ready` before redirecting or rendering.
- All Gun/SEA code is browser-only. Never touch it at module scope or during
  SSR; use `onMount`, event handlers, or `$effect`. `ensureBrowser()` throws on
  the server.
- Graph keys: `~<pub>.{alias,displayName,bio,avatar,epub,friends,fr,messages,gmessages,groups,certs.fr}`,
  `chats/DMs/<channelId>`, `chats/groups/<gid>`, `groups/<gid>/...`,
  `calls/<channelId>`, `calls/groups/<callChannelId>/...`. Changing one requires
  tracing every read/write and preserving the certificate/signature flow.
- Profiles: `displayName` overrides `alias` in the UI. Use `displayNameOf()` from
  `$lib/profile`; use `canSeeAvatar(pub)` from `$lib/gun/Friends.svelte` and omit
  `avatarSource` for non-friends. `/profile` resizes avatars to a 256px JPEG data
  URL before writing `avatar`. Avatar hiding is UI-only; the raw value remains
  public in Gun.
- DM channel: `channelId = SHA-256("amber/dm/v1:" + SEA.secret(peerEpub, self))`,
  so public paths do not reveal the pair. Ciphertext is stored in the sender's
  `messages[channelId][messageId]`; the public index at
  `chats/DMs/<channelId>` stores an SEA-encrypted `{ sig, from }` under
  `<messageId>#<sha256>`. The index signature verifies `"SIGNED_MESSAGE"`.
- `meta` (encrypted with the same secret) carries `replyTo` / `editOf`. Edits
  are append-only events and are never added to the visible list; they apply
  only when the editor matches the original author, and pending edits are
  replayed when the target arrives.
- Message IDs are `Gun.state()` timestamps. Insert in timestamp order via the
  existing binary search; do not re-sort. `navigator.locks`
  (`GUNDB_MESSAGE_POP`, `GUNDB_MESSAGE_ARRAY`, `CHAT_FRIENDS_SIDEBAR`)
  serializes async array updates.
- `listen()` uses a LEX `.on()` query (last 100, `< "\uffff"`);
  `loadHistory()` pages backwards with `.once()` but is not wired into the UI
  yet.
- Do not prefix public souls with `#`; Gun treats them as hash-verified souls
  and normal puts do not ack. `.off` uses `this`: call it on the chain or wrap
  it (`() => chain.off()`), never extract the method.
- Never put a string directly on a soul path. `gun.get("groups/<gid>/current")
  .put(json)` fails with `Data at root of graph must be a node (an object)`
  because a soul must be an object. Put strings as keys on a parent node:
  `gun.get("groups/<gid>").get("current").put(json)`. The same applies to
  `groups/<gid>/meta/<epoch>`, `keys/<epoch>/<tag>`, presence, and signals.
- Friends: invites are `amber://request_friend?cert=...&pub=...`. `createInvite()`
  caches an encrypted `{ "*": "fr" }` cert in `certs.fr`; `addFriend()` writes a
  cert to `~friend.fr[self]`; `acceptFriend()` writes
  `~friend.friends[self]` with the request cert, mirrors the timestamp into
  `self.friends[friend]`, then tombstones `self.fr[friend]` with `null`.
- Groups are owner-only. `Group.ts` creates an opaque `gid`, an epoch key,
  `groups/<gid>/{meta,roster}/<epoch>` snapshots, `keys/<epoch>/<memberTag>`
  envelopes, and a signed `current` pointer. Message ciphertext lives in the
  sender's `gmessages/<storeId>`; the encrypted index is `chats/groups/<gid>`.
  `GroupChannel` mirrors `DMChannel`. Members receive only the epoch they joined
  at, so there is no history backfill. Removing a member rotates the key; old
  messages stay readable to the removed member. Use the base64url helpers in
  `Group/crypto.ts` for path segments (`/` in raw base64 breaks Gun paths).
- Calls: `callManager` is a module singleton; `CallOverlay` calls `init()` /
  `destroy()` as `gunData.user` changes, and the overlay must stay mounted
  globally. Channel ID is `SHA-256("amber/call/v1:" + secret)`. Calls are
  friend-only (`verifyFriend`). Signals are `{ v: 1, callId, type, payload, ts }`
  under `calls/<channelId>/<callId>:<id>`, encrypted, and include `sender`;
  receivers tombstone each record after processing. ICE is gated until the
  offer/answer write completes; remote candidates queue until
  `setRemoteDescription`. `toggleVideo()` enables the camera in an audio call and
  renegotiates; `startScreenShare()`/`stopScreenShare()` swap the video sender
  track. Active calls must handle renegotiation offers/answers, not only the
  initial call setup.
- Group calls: `groupCallManager` is a separate module singleton. The call
  record is `groups/<gid>/call`; presence and signals live under
  `calls/groups/<callChannelId>/{participants,signals}`. It uses a full WebRTC
  mesh (one peer connection per participant) with perfect-negotiation-style
  glare handling; `GroupCallOverlay` must stay mounted globally. After creating
  or joining a group, call `groupCallManager.reload()` so incoming calls are
  subscribed. Keep group calls small; there is no SFU.

## UI conventions

- Svelte 5 runes only; no Svelte stores. Declare prop/state types inline.
- Use `$lib/Components/ui/{button,dialog,input,label}` and `cn()` from
  `$lib/utils` instead of raw HTML/shadcn.
- Discord-style dark tokens live in `src/routes/layout.css`: `bg-app`, `bg-panel`,
  `bg-rail`, `bg-elevated`, `bg-hover`, `bg-selected`, `text-ink`,
  `text-ink-soft`, `text-ink-muted`, `bg-blurple`, `text-positive`. Do not use
  raw `neutral-*`.
- Root shell is `h-dvh` with an `h-14` Navbar; pages fill `h-full`. New protected
  pages go inside `AuthGuard`.
- Use `GunAvatar` for user images (`gunAvatar` fallback) and `Message` for chat
  rows. `Message` handles `compact` grouping (same author, <5 min, no reply),
  reply/edit, long-press action sheet, and swipe-to-reply. Reply/edit state lives
  in the composer, not the message row.
- Display names: always render `displayNameOf(user)`; raw `user.alias` is the
  fallback. Avatars: pass `avatarSource` only when `canSeeAvatar(pub)` is true
  (self or friend); otherwise show the deterministic `gunAvatar` identicon.
- Group pages live under `/groups` with their own `AuthGuard` + `Sidebar`
  layout. `GroupContact` is the sidebar row. `groups/[id]/settings` is
  owner-editable; other members see a read-only view.
- Use `GroupAvatar` (not `GunAvatar`) for groups. It renders
  `GroupMetaSnapshot.avatar` when present, otherwise a deterministic colored
  users icon derived from `gid`; use `GunAvatar` only for people.
- Icons: `lucide-svelte/icons/<name>`. `@lucide/svelte` is also installed; do not
  mix it in.

## Gotchas

- Gun types are incomplete: expect `@ts-expect-error` around `gun-avatar` and
  Gun ack errors, and `as unknown as T` casts at the Gun boundary. Do not silence
  unrelated type errors.
- Gun chains are promise-like; always `await chain.then()` when you need a value
  or write confirmation.
- Messages are text-only; there is no attachment/upload path. Avatars are the
  only binary data and are resized client-side before storage.
- Avatar privacy is UI-only. `~<pub>.avatar` is still readable by anyone who
  inspects Gun; do not claim it is cryptographically hidden.
- Group history is not backfilled: a member added at epoch N cannot read older
  epochs unless someone explicitly gives them those keys. Removal rotates the
  key but does not revoke old messages.
- Group calls are full mesh. Do not raise the member cap without an SFU; every
  participant opens a peer connection to every other participant.
- The app assumes modern browser APIs (`navigator.locks`, `navigator.clipboard`,
  `sessionStorage`) with no fallbacks.
- On Windows, `adapter-vercel` function symlinks need Developer Mode; local
  builds use `adapter-auto`.

## Change checklist

1. Match the surrounding structure and tab indentation; keep changes small.
2. Run `yarn check` and fix new type errors.
3. For graph changes, trace all reads/writes of the affected key, including the
   certificate/signature flow.
4. Verify DMs with a local relay and two separate browser profiles (not two tabs;
   Gun shares `sessionStorage` per origin).
5. For group changes, use three profiles: create, send, edit/reply, add, remove
   (check the removed member cannot decrypt new messages), reload, and confirm a
   newly added member sees no prior history.
6. For call changes, test audio-only -> enable video, screen share start/stop,
   and a 3-person group call. A hardware mute/denied camera should set an error,
   not end the call.
