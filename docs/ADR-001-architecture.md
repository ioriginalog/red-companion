# ADR-001: Stack and Sync Architecture

Status: Accepted · proposed 2026-11-25 · updated 2026-11-27 to describe the system as built

## Context

- Targets: web, desktop and mobile, usable offline at the table.
- Synced GM and player views of the same combat, with players never receiving what their characters can't know (NPC stats, hidden tokens, whispers to others).
- Rules must be deterministic, auditable and identical on every device.
- Distribution must be free (RTG Homebrew Content Policy), so hosting cost and ops burden must stay near zero.

## Decision

### One TypeScript codebase, four packages

npm workspaces; Node 22+.

| Layer | Package | Path | Runs On | Depends On |
|---|---|---|---|---|
| Rules engine | `@cprc/rules-core` | `packages/rules-core` | GM device, relay, tests | Nothing (zero runtime deps) |
| Session and sync | `@cprc/session` | `packages/session` | GM device, relay, player clients | rules-core |
| Relay | `@cprc/relay` | `apps/relay` | Node 22 on Railway, volume at `DATA_DIR` | session, `ws` |
| Web client | `@cprc/web` | `apps/web` | Any modern browser, installable as a PWA | session, React, Vite |

The client ships as a **PWA** (React + Vite, a service worker for the offline shell, IndexedDB for the GM's log cache), served by the relay from the same origin. Native wrappers (Tauri, Capacitor) are not built; add one only when a native feature is needed (app-store presence, file system, haptics). The PWA already runs on desktop and mobile.

### GM-authoritative event log (not CRDTs)

- Players send **intents** ("I shoot Mook 2 with my heavy pistol, aimed at the head").
- The **GM's browser is the authority**: it validates each intent with `handleIntent` (session) and rules-core, rolls dice with `cryptoDice`, and appends a **LogEntry** to an append-only log. Each entry carries `events` (with every raw die value, for the combat log) and a `patch` (upserted actors, encounter, map, pending prompt). Clients replay patches; they never re-run the engine.
- Because only one device writes, there are no merge conflicts. CRDTs (Yjs, Automerge) resolve concurrent edits by merging, but combat needs strict ordering and rule validation. They may still fit free-form shared notes later.
- **Undo** truncates the log to an earlier entry and replays. Replay is deterministic because entries store dice results, not seeds.
- **GM offline:** the GM can keep running the session locally. Its log is cached in IndexedDB, so entries made offline survive a closed tab and are appended when the connection returns.

### Relay

A small Node WebSocket relay instead of a hosted pub/sub service. Reason: players must never receive NPC stats, so the server has to **redact per viewer** before sending. A plain pub/sub channel can't, short of making the GM device upload one copy per player.

What the relay does:

- **Stores** each session as `meta.json` and `log.jsonl` on the volume (`FileStore`; `MemoryStore` when `DATA_DIR` is unset), plus uploaded images, content-addressed.
- **Checks only that entries chain** (sequence numbers without gaps; a gap answers `GAP` and the GM refetches). It never runs rules or rolls dice.
- **Projects per player:** `projectState` for a player's welcome and `projectEntry` for each live entry, run separately for every connected player. Redaction covers NPC HP, SP, stats and roll breakdowns, GM-only rolls, whispers, hidden tokens and hostile watches. A player's welcome carries their last 300 projected entries; an undo sends each player a `rewind` with their rebuilt view and history.
- **Enforces fog of war:** `projectEntry` re-projects the map whenever the map or any actor changes, since a PC stepping forward can reveal a hostile that wasn't in the patch. One geometry function (`hasLineOfSight`) drives both fog and attack legality.
- **Forwards intents** from players to the GM. While the GM is away, it holds them (50 per session, 10 per player, 10 minutes), persisted atomically to `queue.json`, and hands them over in order once the GM has fetched the log. Expired actions produce an explicit `queueDropped` notice.
- **Relays signals** (pings, cursors, ruler lines) without logging them. GM signals reach players only when every square they point at is in the party's current vision.
- **Gates access:** the GM key (hashed at rest) for GM sockets and GM HTTP routes; per-player tokens (hashed) for rejoining; `ALLOWED_ORIGINS` (default same-origin) for session creation, import, uploads and WebSocket upgrades, with `403` for a disallowed Origin.
- **Limits abuse:** session creation and import 20 per hour per address; failed hellos tarpitted (never locked out); at most 8 unauthenticated sockets per address, each allowed one small `hello`; players 5 intents per second (burst 20) and 30 chat messages or free rolls per minute; signals about 10 per second per connection; a per-session log cap (`MAX_LOG_ENTRIES`) with headroom kept for the GM; 512 KB per WebSocket message.
- **Exports and imports** sessions: an export is `{ meta, log }` without secrets; an import always creates a new session with fresh credentials, and must chain from 1 and replay cleanly.

Cost note: Railway isn't free past the trial. The relay is tiny (well under the Hobby plan's included usage), but distribution must stay free under RTG's policy, so hosting is an out-of-pocket cost.

### Dice integrity

Dice are rolled on the authority device through an injected `Dice` interface (`cryptoDice` in the client, `scriptedDice` in tests). Players never roll locally for results that matter; a player tapping "Roll" sends an intent. If players should ever "own" their rolls, use commit-reveal on the relay, not trust.

### Testing

- Unit tests (Vitest) in every workspace. The rules engine is tested with scripted dice, which keeps rules disputes out of bug reports.
- Every log event type must have a redaction fixture in `packages/session/test/redaction.test.ts`, and every intent validates its payload, with hostile-input tests.
- Relay tests run real sockets against both stores (restarts, origins, queue persistence, fog filtering of signals, rate limits).
- `npm run e2e` runs `apps/web/e2e/run.py`: a real relay and headless Chrome through Python Playwright, asserting from captured WebSocket frames that no player receives hidden data.

## Consequences

- A GM without a device can't host. Acceptable for a GM tool.
- Latency for players = one round-trip to the GM device. Fine for turn-based play.
- The GM's browser holds the only copy of the GM key (plus any GM backup file it saves). Losing both locks the GM out of that session; the relay can't recover the key.
- The relay must be trusted with the full log, since it redacts on the server. It's private to the table; there's no multi-tenant hosting.

## Addendum (2026-11-25): Tactical Map and Web Client

- **Map state lives in the log** like everything else: `setMap`, `placeToken` (GM), `moveToken`, `setWatch`, `clearWatch`, `declineWatch`, lighting and revealed squares. Maps are small, so patches replace them whole.
- **Vision** is shared by the party (PCs and allied NPCs): the union of what each conscious friendly token can see, plus squares the GM reveals (or everything, with Reveal All). Exploration fog marks squares the party has ever seen.
- **The web client** is served by the relay from the same origin, so `ALLOWED_ORIGINS` gates session creation and WebSocket upgrades, not just CORS.
