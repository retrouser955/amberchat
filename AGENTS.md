# AGENTS.md

## Project overview

AmberChat is a peer-to-peer messaging app built with SvelteKit and GunDB. Messages are end-to-end encrypted with GunDB's SEA API (Diffie-Hellman shared secrets) and persisted/indexed through Gun's graph and a relay server. There is no application backend: `src/` is a client-only SvelteKit app, and Gun peers exchange/relay data.

## Stack

- SvelteKit 2 + Svelte 5 (runes: `$state`, `$props`, `$effect`, `$bindable`)
- TypeScript (strict), Vite 7, `@sveltejs/adapter-auto`
- Tailwind CSS v4 (`src/routes/layout.css`) and shadcn-svelte / bits-ui components
- GunDB (`gun`, `gun/sea`, `gun/lib/{radix,radisk,store,rindexed}`), `gun-avatar`
- `moment` for relative timestamps, `lucide-svelte` for icons
- Package manager: **Yarn 4** (`packageManager` in `package.json`; `node_modules` is not installed by default)

## Commands

```bash
yarn install          # install dependencies (Yarn 4 via corepack)
yarn dev              # Vite dev server
yarn build            # production build
yarn preview          # preview the build
yarn check            # svelte-kit sync + svelte-check (run after changes)
yarn check:watch      # same, in watch mode
```

There are no tests, linter, or `format` scripts. Prettier config is `{ "useTabs": true }`; `.vscode/settings.json` enforces tabs and disables indentation detection. Match tabs in all source files.

A Gun relay must be running for real messaging. `src/lib/gun/Gun.svelte.ts` reads `PUBLIC_GUN_RELAY` (`$env/dynamic/public`), a comma-separated peer list, and defaults to `http://localhost:3000/gun`. Copy `.env.example` to `.env` to configure it. The README shows a minimal Express + Gun relay (`app.use(Gun.serve)`, `Gun({ web: httpServer })` on port 3000).

## Layout

```
relay/                      # standalone Gun relay (own package.json, deployed separately)
src/
  app.html, app.d.ts
  routes/
    +layout.svelte            # global shell: Navbar + CallOverlay, initializes Gun
    +page.svelte              # landing page
    layout.css                # Tailwind v4 + theme tokens
    chat/+layout.svelte       # AuthGuard + Sidebar + content split
    chat/+page.svelte         # empty-state prompt
    chat/[id]/+page.svelte    # DM conversation for a peer pub key
    friend-requests/+layout.svelte  # AuthGuard
    friend-requests/+page.svelte
  lib/
    gun/
      Gun.svelte.ts           # Gun singleton, auth state, user helpers
      index.ts                # re-exports DMChannel
      Channel/DMChannel.svelte.ts
      User/User.ts            # invites, friend requests, accepting friends
      User/SEA.ts             # empty placeholder
      Time/Time.ts            # empty placeholder
    calls/
      CallManager.svelte.ts   # WebRTC + Gun signaling + friend authorization
    Components/
      AuthGuard, CallOverlay, Navbar, Sidebar, Message, GunAvatar,
      ui/{button,dialog,input,label}
    utils.ts                  # cn(), shadcn prop helper types
    assets/
```

Note the capital `Components` directory (shadcn's default `$lib/components` alias in `components.json` does not match the actual casing on disk). On case-sensitive filesystems, import from `$lib/Components/...`, not `$lib/components/...`.

## GunDB / app architecture

### Core singleton — `src/lib/gun/Gun.svelte.ts`

- `createGun()` lazily creates one `Gun({ peers: [...] })` instance, registers the `"auth"` handler, then calls `gun.user().recall({ sessionStorage: true })` (the order avoids missing a synchronous recall event). It returns the existing instance thereafter.
- `getUser()` ensures Gun exists and returns the recalled Gun user.
- `ensureUserLogged(user)` asserts `user.is` and `user._.sea` exist.
- `gunData` is a rune-backed `$state` object holding `{ user?: { alias, pub, avatar }, ready }`. `ready` flips to `true` after the initial session recall resolves; `AuthGuard` uses it to avoid flashing protected pages or redirecting before recall completes.
- `logout()` calls `user.leave()`, clears the `recall`/`pair` sessionStorage keys, resets `gunData.user`, and leaves `ready` true so `AuthGuard` redirects.
- The `"gun"` module is augmented with the missing `IGunUserInstance._.sea` and `IGunChain.then()` types.

All Gun/SEA code is **browser-only** (uses `window`, `sessionStorage`, `navigator.locks`). Call it from `onMount`, event handlers, or `$effect`, never at module scope or during SSR. `ensureBrowser()` uses `typeof window === "undefined"` and throws on the server; protected routes are wrapped in `AuthGuard` (`src/lib/Components/AuthGuard/AuthGuard.svelte`).

### Direct messages — `src/lib/gun/Channel/DMChannel.svelte.ts`

The `DMChannel` class encapsulates one 1:1 conversation:

1. `channelId = SHA-256("amber/dm/v1:" + sharedSecret)`, derived lazily and asynchronously from `SEA.secret(peerEnc, user._.sea)`. This hides the pair of public keys from the public index and message paths. `chat/+layout.svelte` keys the page content by `page.url.pathname`, so switching peers remounts the page and creates a fresh `DMChannel`.
2. `fetchUserEpub()` reads the peer's `epub` (public encryption key) from `~<pub>`.
3. `send(content)`:
   - derives the shared secret with `SEA.secret(peerEnc, user._.sea)`;
   - encrypts content with that secret (`SEA.encrypt(content, { epriv: secret })`);
   - stores the encrypted message under the sender's own user space: `user.messages[<opaqueChannelId>][messageId] = { content }`;
   - encrypts the index envelope `{ sig, from }` with the same secret and writes it to `chats/DMs/<opaqueChannelId>` as `"<messageId>#<sha256>"`. `sig` is `SEA.sign("SIGNED_MESSAGE", user._.sea)`. Do not prefix public souls with `#`: Gun treats those as hash-verified souls and normal puts do not persist/ack.
4. `listen()` subscribes with `.on()` to a Gun LEX query (last 100 entries, `< "\uffff"`) so new messages arrive live without a reload; `loadHistory()` pages backwards from `lastMessage` with `.once()`. Each encrypted index entry is decrypted, signature-verified with `SEA.verify`, then the actual message is fetched from `~<from>.messages[<opaqueChannelId>][messageId]` and decrypted. A message key is cached only after it is rendered successfully, so a content read that has not synced yet can be retried.
5. Messages are inserted in timestamp order via binary search (`getSortIndex`/`insertAtSortIndex`); do not re-sort after insertion. `navigator.locks` (`GUNDB_MESSAGE_POP`, `GUNDB_MESSAGE_ARRAY`, `CHAT_FRIENDS_SIDEBAR`) serializes async updates to arrays.

`loadHistory()` is implemented but not yet surfaced in the UI. Keep when extending the chat view. Note that Gun's `.off` method uses `this`; wrap chains in a closure (`() => chain.off()`) instead of extracting `.off` directly. The opaque channel scheme is a breaking data change: messages stored under the old pub-pair channel ID (or the older `#chats` namespace) are not read.

`Sidebar` and `friend-requests` also use `.on()` so friend/friend-request lists update live, and both return a cleanup that calls `chain.off()`.

### Friends / invites — `src/lib/gun/User/User.ts`

- Invites are `amber://request_friend?cert=...&pub=...` URLs built by `createInviteUrl`.
- `createInvite()` creates (once, cached encrypted under `user.certs.fr`) a SEA certificate for `{ "*": "fr" }` and returns the invite URL.
- `addFriend(code)` verifies the `amber:` protocol, validates `cert`/`pub`, and writes a friend-request certificate to `~<friendPub>.fr[userPub]` using the inviter's cert.
- `acceptFriend(friendPub)` writes `Gun.state()` into `~<friendPub>.friends[userPub]` with the request cert, mirrors the timestamp into `user.friends[friendPub]`, then tombstones `user.fr[friendPub]` with `null`.

When changing graph keys (`fr`, `friends`, `messages`, `certs.fr`, `epub`, `chats/DMs/...`, `calls/...`) keep writes and reads in sync across these modules and components, and preserve the certificate/signature flow.

### Voice/video calls — `src/lib/calls/CallManager.svelte.ts`

- `CallManager` is a global singleton instantiated from `CallOverlay` in the root layout. It subscribes to the logged-in user's `friends` graph and, for each friend, to a shared call channel.
- The call channel ID is `SHA-256("amber/call/v1:" + sharedSecret)`, so the channel path does not reveal either public key. Domain-separating the DM and call hashes prevents correlating the two channel types.
- Calls are friend-only. `startCall()` verifies the peer is in the caller's `friends` graph, and incoming offers run `verifyFriend(peer.pub)` before ringing. Because only the pair can derive the channel ID, non-friends cannot inject signals.
- Signaling is a JSON record `{ v, callId, type, payload, ts }` written under `calls/<opaqueChannelId>/<callId>:<messageId>`. `payload` is SEA-encrypted with the ECDH shared secret (`SEA.secret(peer.epub, user._.sea)`) and includes the sender pub inside the encrypted payload so a peer can ignore its own signals.
- Signal types are `offer`, `answer`, `candidate`, `reject`, and `hangup`. Records are deleted (tombstoned) after the receiving peer processes them; senders leave their own records for the peer to consume.
- ICE candidates are gated until the offer/answer write completes so they cannot overtake the SDP. Remote candidates are queued until `setRemoteDescription`.
- Media uses WebRTC with Google STUN by default. `PUBLIC_TURN_URL`, `PUBLIC_TURN_USERNAME`, and `PUBLIC_TURN_CREDENTIAL` add a TURN server for strict NAT/firewall environments.
- `CallOverlay` handles incoming/outgoing/active UI and must stay mounted globally so calls ring on any route.

## UI conventions

- Svelte 5 runes only; no Svelte stores. Types are declared inline in `$props()`/`$state()`.
- Use existing primitives from `$lib/Components/ui/{button,dialog,input,label}` rather than raw shadcn/HTML where one exists. `button` exports `variant`/`size` types, `buttonVariants`, and renders `<a>` when `href` is passed.
- Use `cn()` from `$lib/utils` to merge Tailwind classes.
- Use `GunAvatar` for user images (falls back to `gunAvatar({ pub, size })` from `gun-avatar`), and `Message` for chat rows.
- The app uses a Discord-inspired dark palette defined in `src/routes/layout.css` (`bg-app`, `bg-panel`, `bg-rail`, `bg-elevated`, `bg-hover`, `bg-selected`, `text-ink`, `text-ink-soft`, `text-ink-muted`, `bg-blurple`, `text-positive`). Reuse these tokens instead of raw `neutral-*` classes.
- The root shell is a `h-dvh` flex column with a 3.5rem (`h-14`) Navbar; pages use `h-full`. The legacy `.h-enough` utility is now `calc(100vh - 3.5rem)`.
- `Contact` renders a link to `/chat/{pub}` and derives its active state from `page.url.pathname`; follow SvelteKit patterns (e.g. `$app/state` for `page.params`, `$app/navigation` for `goto`) as in existing routes.
- `Message` supports a `compact` prop for grouped consecutive messages; the chat page sets it when the same author posts within five minutes.
- The chat layout is `AuthGuard` → `Sidebar` (240px, collapsing to 64px below `md`) → main conversation pane. Keep new protected pages inside an `AuthGuard`.
- Prefer `lucide-svelte/icons/<name>` for icons (both `lucide-svelte` and `@lucide/svelte` are installed; use the former to stay consistent).

## Gotchas and known rough edges

- Gun types are incomplete/loose: expect `@ts-expect-error` around gun-avatar calls and Gun acknowledgment errors (`ack.err`), and use `as unknown as T` casts where necessary. Do not silence unrelated type errors.
- Gun chains are promise-like via `.then()`; always await `.then()` when you need the value or write confirmation.
- Empty files `src/lib/gun/User/SEA.ts` and `src/lib/gun/Time/Time.ts` are placeholders, not accidental deletions.
- Timestamps double as Gun message IDs (`Gun.state()`), so message IDs are not arbitrary; ordering depends on them.
- `Gun` state is a client singleton whose peers come from `PUBLIC_GUN_RELAY` (`$env/dynamic/public`, comma-separated, default `http://localhost:3000/gun`). Do not read `process.env` in shipped client code.
- The app assumes browser APIs (`navigator.locks`, `navigator.clipboard`, `sessionStorage`) with no fallbacks.

## Change checklist

1. Make the smallest change consistent with existing structure and tab indentation.
2. Run `yarn check` and fix any new type errors.
3. For Gun/graph changes, trace every read and write of the affected key (including `DMChannel`, `User`, `Sidebar`, `Navbar`, `friend-requests`, `chat/[id]`).
4. Verify messaging manually with a local relay at `localhost:3000` and two browser sessions/users.
