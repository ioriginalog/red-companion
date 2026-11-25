# Night Shift Companion

Unofficial fan tool for running Cyberpunk RED combat: a rules engine, a synced session layer, and a small private tactical table. Not affiliated with, approved by or endorsed by R. Talsorian Games.

| Package | What It Is |
|---|---|
| `packages/rules-core` | Zero-dependency combat rules engine. Pure: no I/O, no clock, injected dice. |
| `packages/session` | Event-sourced session layer: intents, GM authority, replay, per-player redaction, wire protocol. |
| `apps/relay` | WebSocket relay deployed on Railway: stores logs, forwards player intents to the GM, sends redacted updates to players, serves the web client. |
| `apps/web` | Vite + React client: tactical map with fog of war, targeting and watch cones, initiative strip, attack panel. The GM's browser is the rules authority. |

See [`docs/ADR-001-architecture.md`](docs/ADR-001-architecture.md) for the stack and sync design.

**Read [`docs/rules-verification.md`](docs/rules-verification.md) before trusting any number.** It lists the source and confidence level of every rule.

## Quick Start

```bash
npm ci
npm test            # builds all packages, then runs every test suite
npm run build && PORT=8080 DATA_DIR=./.data npm start   # relay + web client on http://localhost:8080
npm run dev -w @cprc/web   # hot-reload client on :5173 (proxies to the relay on :8080)
```

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

## Module Map

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

## Session Layer

```
player ──intent──▶ relay ──intent──▶ GM device (authority: handleIntent + dice)
                                          │ LogEntry {events, patch}
player ◀─projected entry── relay ◀─append─┘   (relay redacts per player)
```

- **Intents** are requests (`rangedAttack`, `respondDodge`, `rollDamage`, `deathSave`, `endTurn`, GM setup…). The authority accepts or rejects them.
- **Flow rules:** players act only through actors they control, on that actor's Turn. One pending step at a time (a dodge decision or a damage roll). A dying actor must roll its Death Save before acting. Dead or unconscious-but-stable actors are skipped in the Turn order.
- **Dodge prompt:** when a REF 8+ defender is attacked, the attack pauses until the defender's controller answers. The attack is validated (range, ammo, mode) *before* the prompt, so nobody is asked to decide on an illegal shot.
- **Redaction:** players see full sheets for their own actors and other PCs; NPCs show only name, Wound State, conditions and injury names. HP, SP, stats and roll breakdowns for NPCs are stripped from both snapshots and entries.

### Relay API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness and protocol version |
| `POST /api/sessions` | Create a session → `{ sessionId, gmKey, joinCode }`. **The GM key is shown once; store it on the GM device.** Rate-limited per IP. |
| `POST /api/sessions/:id/assets` | GM only (`Authorization: Bearer <gmKey>`). Raw WebP, PNG or JPEG body, 8 MB max, checked against its magic bytes. Content-addressed (same bytes → same URL); 200 MB per session. → `201 { url: '/u/:id/<sha256>.<ext>' }` |
| `GET /u/:id/<sha256>.<ext>` | Uploaded image, cached immutably, `nosniff`, `default-src 'none'` |
| `GET /api/sessions/:id/export` | GM only. Download `{ meta, log }` as JSON (no key or token hashes) |
| `POST /api/sessions/import` | Body = an export. Creates a **new** session (fresh GM key and join code) whose log is the export's; every entry must chain from 1 and replay cleanly. Players rejoin and are reassigned. Rate-limited like session creation; 25 MB max. |
| `WS /ws` | Protocol in `packages/session/src/protocol.ts`. `signal` messages (ping, cursor, measure) are relayed to the rest of the room, never logged, and rate-limited to about 10 per second per connection (excess is dropped). |

Environment:

| Variable | Meaning |
|---|---|
| `PORT` | Listen port (Railway sets it). |
| `HOST` | Listen address, default `::` (falls back to `0.0.0.0`). |
| `DATA_DIR` | Volume path for logs, metadata and uploads. Unset = in memory, lost on restart. |
| `ALLOWED_ORIGINS` | Browser origins allowed to create or import sessions, upload, and open sockets. **Unset = same-origin only** (the Origin's host must match the Host header). Comma-separated list = exactly those. `*` = any (not recommended). |
| `TRUST_PROXY_HOPS` | Reverse proxies in front of the relay. Unset or `0` = rate limits and lockouts use the socket address and ignore `X-Forwarded-For` (it's client-controlled). `N` = use the Nth `X-Forwarded-For` entry from the right. **Railway: `1`.** |
| `WEB_DIR` | Built client to serve; default `apps/web/dist`. |

**Sync behavior worth knowing:**

- **Failed hellos** (unknown join codes, wrong GM keys) draw from a per-address bucket of 10 that refills one every 30 seconds. A correct GM key or player token always gets in, even from a locked address; only guessing and brand-new joins wait. The client keeps its saved session and retries when the lock lifts.
- **GM offline:** players' actions are held at the relay (50 per session, 10 per player, up to 10 minutes) and handed to the GM in order once it reconnects and has fetched the log. The GM device caches its log in IndexedDB, so actions taken offline survive a closed tab and sync on reopen.
- **History:** a player's welcome carries their last 300 projected log entries (events only, redacted exactly like live updates); the GM rebuilds its feed from the whole log.
- **Unseen hostiles** are absent from the players' Turn order; while one acts, players see a single "Unknown Contact Acting" slot, never a count.

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

- [ ] **App name** must not include "Cyberpunk RED". "Night Shift Companion" is a placeholder chosen to stay clear of the trademark; the final name is your call.
- [ ] **Disclaimer** in a visible spot (About screen and store listing). Draft: *"[App Name] is unofficial content provided under R. Talsorian Games' Homebrew Content Policy. It is not approved or endorsed by R. Talsorian Games. It references material that is the property of R. Talsorian Games and its licensees."* Check it against the current policy page before release.
- [ ] **Free**, with no paywall or subscription; no itch.io or DriveThruRPG distribution. App-store distribution is allowed when free.
- [ ] **No full NPC stat blocks** from any RTG book, in data or seed files. Users create their own NPCs.
- [ ] **Text = summaries + page refs only.** `src/data/` holds numbers and one-line paraphrases; never paste rulebook prose. Policy is ambiguous on full tables in apps, which is why tables live in one swappable data pack.
- [ ] **No RTG logos, art, trade dress, fonts or colors.**
- [ ] **Hardcoded lore:** none in this package. Weapon, armor and injury names are game terms. "Kevlar" is a DuPont trademark used in the book; consider "Kevlar-Style" or keep with a ® note.
- [ ] **Duplication risk:** RTG can request removal if an official or licensed product does the same job. Licensed VTT integrations exist, so keep the app focused on table-side combat speed rather than becoming a full VTT.
- [x] **Art:** the warehouse map and portraits were generated for this project with open image models (Z-Image Turbo on Hugging Face). No RTG or CD PROJEKT RED art, logos or characters. Demo characters and stats are original.
- [ ] **2077 setting (CD PROJEKT RED Fan Content Guidelines):** non-commercial only. Don't add CDPR art, logos, UI assets, music or named characters; place names and gangs are fine in your own session data, not in shipped seed files.
