# Night Shift Companion

Unofficial fan tool for running Cyberpunk RED combat: a rules engine, a synced session layer, and a small private tactical table. Not affiliated with, approved by or endorsed by R. Talsorian Games.

| Package | What It Is |
|---|---|
| `packages/rules-core` | Zero-dependency combat rules engine. Pure: no I/O, no clock, injected dice. |
| `packages/session` | Event-sourced session layer: intents, GM authority, replay, per-player redaction, wire protocol. |
| `apps/relay` | Node WebSocket relay (deployed on Railway): stores each session's log, forwards player intents to the GM, sends every player their own redacted view, holds player actions while the GM is away, and serves the web client. It never runs rules or rolls dice. |
| `apps/web` | Vite + React installable web app (PWA): tactical map with fog of war, targeting and watch cones, initiative strip, attack and NET panels, character editors. The GM's browser is the rules authority and caches its log in IndexedDB. |

See [`docs/ADR-001-architecture.md`](docs/ADR-001-architecture.md) for the stack and sync design.

**Read [`docs/rules-verification.md`](docs/rules-verification.md) before trusting any number.** It lists the source and confidence level of every rule.

## Quick Start

```bash
npm ci
npm test            # builds all packages, then runs every test suite
npm run typecheck   # tsc in every workspace
npm run build && PORT=8080 DATA_DIR=./.data npm start   # relay + web client on http://localhost:8080
npm run e2e         # builds, then the browser end-to-end suite against a real relay
npm run dev -w @cprc/web   # hot-reload client on :5173 (proxies to the relay on :8080)
```

The end-to-end suite (`apps/web/e2e/run.py`) starts its own relay with a throwaway `DATA_DIR` and drives headless Chrome through Python Playwright. It checks identity across a relay restart, redaction over a scripted encounter (no hidden data in any player frame), offline GM actions surviving a closed tab, undo reaching players, rate limits under bursts, that GM pings, ruler lines and cursors from fogged squares never reach a player, and that players receive nothing at all for entries they can't see (unseen Turns, private rolls, others' whispers), area prompts and Black ICE checks as totals only, masked unexplored terrain, generic refusals, carried-gear checks, reserved GM names, and the GM roster (rename, merge, remove, seat reclaim). It needs `pip install playwright` and Chrome at `/usr/bin/google-chrome` (or set `CHROME=/path/to/chrome`). The relay listens on `E2E_PORT` (default 8191; local relays use 8191–8193); `E2E_ONLY=<n>` runs one check group.

Create a session, choose **Load Demo Encounter**, share the join code, assign each player a character in the Roster, then **Start Encounter**.

```ts
import { resolveRangedAttack, rollDamage, applyDamage, cryptoDice } from '@cprc/rules-core';

const dice = cryptoDice();
const atk = resolveRangedAttack(
  { attacker: solo, defender: ganger, weapon: heavyPistol, distance: 10, aimTarget: 'head' },
  dice,
);
if (atk.damage) {
  const roll = rollDamage(atk.damage, dice);
  const { target, events } = applyDamage(ganger, atk.damage, roll, dice);
  // append atk.events + events to the session log; replace ganger with target
}
```

## Rules Engine Module Map (`packages/rules-core`)

| File | Responsibility |
|---|---|
| `src/types.ts` | Data schema (Combatant, ArmorPiece, Weapon, DamageSpec, …) |
| `src/data/core.ts` | Rules data pack: range/Autofire DVs, weapon and armor types, constants |
| `src/data/critical-injuries.ts` | Body and Head Critical Injury tables as structured effects |
| `src/checks.ts` | d10 with Critical Success/Failure; tie rule |
| `src/character.ts` | HP, Wound State, effective STATs, SP, ablation, standing modifiers |
| `src/attack.ts` | Ranged (single, Aimed, Autofire) and melee (weapon, Brawling, Martial Arts) |
| `src/damage.ts` | The 10-step damage pipeline (documented at the top of the file) |
| `src/area.ts` | Shotgun Shells, Explosives, Suppressive Fire, cover |
| `src/health.ts` | Death Saves, Stabilization, turn-start checklist |
| `src/initiative.ts` | Initiative with tie rerolls |
| `src/events.ts` | Event types for the sync log, with a visibility hint |
| `src/data/packs.ts` | Rules-pack format and validation (GM-imported catalogs; see below) |

Also in `src/`: `ammo`, `cover`, `wield`, `grid`, `grapple`, `martial`, `facedown`, `roles`, `roles-extra`, `cyberware`, `healing`, `injury-effects`, and `net/` (the Netrunning engine).

## Rules Data and Rules Packs

- **Built-in data** lives in `packages/rules-core/src/data/`: numbers, tables and one-line paraphrases only (range and Autofire DVs, weapon and armor types, Critical Injury tables). It's kept in one place so it can be swapped out.
- **Shipped examples are original.** The demo encounter, characters, starter Programs, Black ICE and example cyberware were written for this tool; no RTG stat blocks, Program or ICE names, or rulebook text are shipped.
- **Rules packs** let a GM who owns the books add official catalogs (cyberware, Programs) on their own device: Characters → Cyberware and Humanity → Import Rules Pack. A pack is a JSON file with `"format": "nsc-rules-pack"`; it's validated strictly, stored only in that GM's browser, and never written to the session log, the relay or this repository. The full format is in [`docs/rules-verification.md`](docs/rules-verification.md#rules-packs-and-book-values-round-3).

## Session Layer

```
player ──intent──▶ relay ──intent──▶ GM device (authority: handleIntent + dice)
                                          │ LogEntry {events, patch}
player ◀─projected entry── relay ◀─append─┘   (relay redacts per player)
```

- **Intents** are requests (`rangedAttack`, `respondDodge`, `rollDamage`, `deathSave`, `endTurn`, GM setup…). The authority accepts or rejects them.
- **Flow rules:** players act only through actors they control, on that actor's Turn. One pending step at a time (a dodge decision or a damage roll). A dying actor must roll its Death Save before acting. Dead or unconscious-but-stable actors are skipped in the Turn order.
- **Dodge prompt:** when a REF 8+ defender is attacked, the attack pauses until the defender's controller answers. The attack is validated (range, ammo, mode) *before* the prompt, so nobody is asked to decide on an illegal shot.
- **Redaction:** players see full sheets for their own actors and other PCs; NPCs show only name, Wound State, conditions and injury names. HP, SP, stats and roll breakdowns for NPCs are stripped from both snapshots and entries. The relay projects every entry separately for each player (`projectEntry`), so whispers, GM-only rolls, hidden tokens and enemy watches never leave the server for players who shouldn't have them.

### Relay API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness and protocol version |
| `POST /api/sessions` | Create a session → `{ sessionId, gmKey, joinCode }`. **The GM key is shown once; store it on the GM device.** Rate-limited per IP. |
| `POST /api/sessions/:id/assets` | GM only (`Authorization: Bearer <gmKey>`). Raw WebP, PNG or JPEG body, 8 MB max, checked against its magic bytes. Content-addressed (same bytes → same URL); 200 MB per session. → `201 { url: '/u/:id/<sha256>.<ext>' }` |
| `GET /u/:id/<sha256>.<ext>` | Uploaded image, cached immutably, `nosniff`, `default-src 'none'` |
| `GET /api/sessions/:id/export` | GM only. Download `{ meta, log }` as JSON (no key or token hashes) |
| `POST /api/sessions/import` | Body = an export. Creates a **new** session (fresh GM key and join code) whose log is the export's; every entry must chain from 1 and replay cleanly. Players rejoin and are reassigned. Rate-limited like session creation; 25 MB max. |
| `WS /ws` | Protocol in `packages/session/src/protocol.ts`. An upgrade from a disallowed Origin gets `403`. `signal` messages (ping, cursor, measure) are relayed to the rest of the room, never logged, and rate-limited to about 10 per second per connection (excess is dropped). |

A request from a disallowed Origin gets `403`; a GM-only request without the right key gets `401`.

Environment:

| Variable | Meaning |
|---|---|
| `PORT` | Listen port, default `8080` (Railway sets it). |
| `HOST` | Listen address, default `::` (falls back to `0.0.0.0`). |
| `DATA_DIR` | Volume path for logs, metadata, uploads and held player actions. Unset = in memory, lost on restart (the relay logs a warning). |
| `ALLOWED_ORIGINS` | Browser origins allowed to create or import sessions, upload, and open sockets. **Unset = same-origin only** (the Origin's host must match the Host header). Comma-separated list = exactly those. `*` = any (not recommended). |
| `TRUST_PROXY_HOPS` | Reverse proxies in front of the relay. Unset or `0` = rate limits and lockouts use the socket address and ignore `X-Forwarded-For` (it's client-controlled). `N` = use the Nth `X-Forwarded-For` entry from the right. **Railway: `1`.** |
| `WEB_DIR` | Built client to serve; default `apps/web/dist`. |
| `MAX_LOG_ENTRIES` | Log entries per session before appends are refused (minimum 1000, default 20000; anything lower or not a whole number falls back to the default). Player chat and free rolls pause 2% (at least 50 entries) short of it so the GM always has headroom. |

The end-to-end suite also reads `CHROME` and `E2E_PORT` (see Quick Start).

**Sync behavior worth knowing:**

- **Failed hellos** (unknown join codes, wrong GM keys) are tarpitted, never locked out. The first 5 failures from an address cost nothing; after that every unauthenticated hello from that address waits about a second per extra failure, capped at 5 seconds, and failures decay one per 30 seconds. A correct GM key or player token is never delayed. At most 8 unauthenticated sockets per address are open at once. Trade-off: someone guessing join codes on the same network slows *new* joins there by a few seconds; in exchange a mistyped code (or a noisy housemate) can never lock the table out. With join codes of 6 characters from 31 (about 887 million) and these limits, guessing one is impractical.
- **Before hello**, a socket gets exactly one small (4 KB), well-formed `hello`; anything else closes it.
- **Player rate limits:** 5 actions per second per player (burst 20), and at most 30 chat messages and free rolls per minute. Excess is refused with `RATE_LIMITED` (the player sees why).
- **Undo:** when the GM undoes, each player gets a `rewind` with their view and history rebuilt, so undone lines disappear from their logs.
- **Log size and compaction:** the log only grows. For long campaigns, export the session (GM menu → Export Session) at the end of an arc and import it as a fresh session, or start a new session for the next arc; the export is the archive.
- **GM offline:** players' actions are held at the relay (50 per session, 10 per player, up to 10 minutes) and handed to the GM in order once it reconnects and has fetched the log. Held actions are written atomically to `DATA_DIR/sessions/<id>/queue.json` after every change, so they survive a relay restart. An action that expires is never dropped silently: the player gets a `queueDropped` notice (on their next join, if they were away), and a reconnecting player's welcome lists which of their actions are still held, so the client corrects its "Queued" count and says if anything was lost. The GM device caches its log in IndexedDB, so actions taken offline survive a closed tab and sync on reopen.
- **GM pings, ruler and cursor stay out of the fog:** the relay sends a GM signal to players only when every square it points at is in the party's current vision; a GM cursor or ruler that moves into the fog is cleared for players. Players' own signals go to the whole room. The GM can also turn off **Show My Pings and Ruler to Players** (Scene tab) to keep them private entirely.
- **History:** a player's welcome carries their last 300 projected log entries (events only, redacted exactly like live updates); the GM rebuilds its feed from the whole log.
- **Unseen hostiles** are absent from the players' Turn order; while one acts, players see a single "Unknown Contact Acting" slot, never a count.
- **Nothing to count:** the relay sends a player an entry only if it shows them something (a visible event, or a change to their projected view). Unseen hostiles' Turns, GM bookkeeping, private rolls and other players' whispers send them nothing at all, and players' entries are numbered per connection (`seq` counts what that socket received, never the log's seq), so there are no gaps to count either. An entry whose content is partly hidden carries no `by` or `intentType`.
- **Refusals don't leak:** a player's intent that names an actor the party hasn't seen is refused exactly like one naming an id that doesn't exist ("You can’t do that."); refusals about NPCs whose sheet they can't see never name them.
- **Unexplored terrain** reaches players as `?` squares (and no cover records there): only squares the party has explored or sees now carry real terrain. The painted background is still sent whole; the client's fog covers it.
- **Shields and drugs must be carried:** catalog shields and drugs are gear entries linked to the catalog (`{ name, qty, item: 'shield:<id>' | 'drug:<id>' }`). Only the GM adds them; players equip and dose only what their character carries, and each use takes one from the list. Custom shields and drugs are GM-only.
- **Player identities:** names that read as the GM ("GM", "G M", "Game Master", "Bob (GM)" and look-alikes) are reserved, and GM chat carries `by: 'gm'`. Identities that control no character and have been offline 10 minutes don't count toward the 12-player cap and are pruned when a new player needs the room. The GM can rename, remove and merge players (merging moves characters to the kept identity). A returning player who joins on a new device under an existing name gets a fresh identity and the GM is asked whether to give them that seat; approving merges the new device into it.

## Edge Cases the Engine Enforces

- **Ties go to the defender**, always: `attack > DV`, never `>=`.
- **Melee weapons count half SP, rounded up** (SP 11 → 6), but ablation hits the armor's real SP (11 → 10). Brawling counts full SP.
- **No ablation when damage ≤ SP.** Armor only wears down when something gets through.
- **Critical Injuries ignore armor.** Two 6s on the damage dice cause one even if armor stopped everything; the +5 bonus never ablates and isn't doubled by headshots.
- **Headshot multiplier applies after SP**: (damage − head SP) × 2, or × 3 with Cracked Skull.
- **Dodge replaces the range DV even when it's worse** for the defender. The UI should make that clear before they commit.
- **Armor penalties hit REF before the dodge check**: a REF 9 Solo in Flak (−4) can't dodge bullets.
- **Mortally Wounded is a spiral**: every damaging hit adds a Critical Injury and +1 Death Save Penalty, on top of the +1 from each Death Save.
- **Natural 10 on a Death Save always kills**, whatever BODY is. Death Saves don't get Critical Success/Failure dice.
- **Autofire needs 10 rounds loaded** and is capped at 100 m/yds.
- **Duplicate Critical Injuries are rerolled**; if a table is full, the engine stops and asks the GM rather than looping.

## Live-Play UX Notes (for the UI Package)

- **Attack in three taps:** pick target → pick weapon/mode → roll. Distance is a band picker (0–6, 7–12, …), not a number field; show the DV on each band button.
- **Only show "Dodge?" when the defender is eligible** (`canDodgeRanged`). Show the range DV beside it so the defender can judge the gamble.
- **"Hit — Roll Damage" is its own button.** Keeps the table's rhythm and lets the GM narrate between steps.
- **Damage card** shows the math in one line: `14 dmg − 6 SP (½ of 11) = 8 → HP 32 → 24 · SP 11 → 10`.
- **Combatant tile:** HP bar colored by Wound State, SP pips per location, active injury chips, a skull badge with the current Death Save Penalty.
- **Turn start:** if `turnStartChecklist().deathSaveRequired`, the Death Save button replaces the action bar until rolled.
- **Undo** is "rewind the log one event", not a per-field edit.

## IP Compliance Checklist (RTG Homebrew Content Policy)

Checked items are true of the code as it stands; recheck them against the current policy pages before any public release.

- [x] **App name** doesn't include "Cyberpunk RED". "Night Shift Companion" was chosen to stay clear of the trademark; the final name is the owner's call.
- [x] **Disclaimer shipped.** The full text is in Help and About (`DISCLAIMER` in `apps/web/src/table/panels.tsx`): *"This is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees."* The home screen carries it too. A store listing, if there ever is one, needs the same text.
- [x] **Free**, with no paywall, accounts or subscription. Not distributed on itch.io or DriveThruRPG. App-store distribution would be allowed while free. Hosting is an out-of-pocket cost (see the ADR).
- [x] **No NPC stat blocks** from any RTG book, in data or seed files. The demo encounter's characters and stats are original; users create their own NPCs.
- [x] **Text = summaries + page refs only.** `packages/rules-core/src/data/` holds numbers and one-line paraphrases; no rulebook prose. Official catalogs come only from GM-imported rules packs that stay on the GM's device. The policy is ambiguous on full tables in apps, which is why tables live in one swappable data pack.
- [x] **No RTG logos, art, trade dress or fonts.** Type is Barlow and Barlow Condensed (SIL Open Font License); the navy, cyan and magenta palette is this project's own.
- [x] **Trademarks in game terms:** "Kevlar" is a DuPont trademark used in the book; the armor table shows it as "Kevlar®" with a note in `data/core.ts`.
- [x] **Art:** the warehouse map and portraits were generated for this project with open image models (Z-Image Turbo on Hugging Face). No RTG or CD PROJEKT RED art, logos or characters.
- [x] **2077 setting (CD PROJEKT RED Fan Content Guidelines):** non-commercial; no CDPR art, logos, UI assets, music or named characters ship. Place names and gangs are fine in a GM's own session data, not in shipped seed files.
- [ ] **Duplication risk (ongoing):** RTG can request removal if an official or licensed product does the same job, and licensed VTT integrations exist. This is now a private virtual tabletop, so keep it free, private and focused on running RED at the table, and be ready to take it down if asked.
