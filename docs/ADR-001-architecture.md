# ADR-001: Stack and Sync Architecture

Status: Proposed · 2026-11-25

## Context

- Targets: web, desktop and mobile, usable offline at the table.
- Synced GM and player views of the same combat.
- Rules must be deterministic, auditable and identical on every device.
- Distribution must be free (RTG Homebrew Content Policy), so hosting cost and ops burden must stay near zero.

## Decision

### One TypeScript codebase, three layers

| Layer | Package | Runs On | Depends On |
|---|---|---|---|
| Rules engine | `@cprc/rules-core` | Client, server, tests | Nothing (zero runtime deps) |
| Session/sync | `@cprc/session` | GM device, relay, player clients | rules-core |
| Relay | `@cprc/relay` | Railway (Node 22, volume at /data) | session |
| UI | `@cprc/app` (next) | PWA, wrapped by Tauri (desktop) and Capacitor (mobile) | session |

Ship as a **PWA first** (React + Vite, service worker, IndexedDB). Wrap with Tauri and Capacitor only when a native feature is needed (app-store presence, file system, haptics). "All platforms" on day one means three build pipelines to debug before the core loop is proven; the PWA already runs on all three.

### GM-authoritative event log (not CRDTs)

- Players send **intents** ("I shoot Mook 2 with my heavy pistol, aimed at the head").
- The **GM device is the authority**: it validates the intent with rules-core, rolls the dice, and appends **events** (with every raw die value) to an append-only log.
- Every client renders a **projection** of the log. The player projection is redacted (NPC HP, NPC stats, GM-only rolls).
- Offline: the GM can run the whole session locally; the log syncs when a connection returns. Because only one device writes, there are no merge conflicts.
- Undo = truncate the log to an earlier event and replay. Replay is deterministic because events store dice results, not seeds.

CRDTs (Yjs/Automerge) are the wrong tool for combat: they resolve concurrent edits by merging, but combat needs strict ordering and rule validation. They may still fit free-form shared notes later.

### Transport (revised 2026-11-25)

A small WebSocket relay on Railway instead of Supabase. Reason: players must never receive NPC stats, so the server has to **redact per viewer** before sending. A dumb pub/sub channel can't do that without pushing redaction onto the GM device (one upload per player). The relay holds the canonical log on a Railway volume (JSONL), checks only that entries chain, and runs `projectEntry` for each player. It never runs rules or rolls dice.

Each LogEntry carries `events` (for the combat log) and a `patch` (upserted actors, encounter, pending). Clients replay patches; they never re-run the engine. Undo = truncate and replay.

Cost note: Railway isn't free past the trial. The relay is tiny (well under the Hobby plan's included usage), but distribution must stay free under RTG's policy, so hosting is an out-of-pocket cost.

### Dice integrity

Dice are rolled on the authority device through an injected `Dice` interface. Players never roll locally for results that matter; a player tapping "Roll" sends an intent. If you later want players to "own" their rolls, use commit-reveal on the relay, not trust.

## Consequences

- A GM without a device can't host. Acceptable for a GM tool.
- Latency for players = one round-trip to the GM device. Fine for turn-based play.
- The rules engine is fully unit-testable with scripted dice, which is how we keep rules disputes out of bug reports.

## Addendum (2026-11-25): Tactical Map and Web Client

- **Map state lives in the log** like everything else: `setMap`, `placeToken` (GM), `moveToken`, `setWatch`, `clearWatch`, `declineWatch`. The map is small (24 × 16 squares), so patches replace it whole.
- **Fog of war is enforced at the relay**, not the client. `projectEntry` takes the state *after* an entry and re-projects the whole map for players whenever the map or any actor changes, because a PC stepping forward can reveal a hostile that wasn't in the patch. Hidden tokens and hostile watches never leave the server.
- **One geometry function** (`hasLineOfSight`) drives both fog and attack legality, so what a player can see and what they can shoot never disagree about walls.
- **The web client** (`apps/web`, Vite + React) is served by the relay from the same origin. The GM's browser is the authority: it replays the log, runs intents with real dice, and appends entries. `ALLOWED_ORIGINS` now gates session creation and WebSocket upgrades, not just CORS.
