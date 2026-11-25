# VTT Workplan (2026-11-25)

Goal: take the tactical table to VTT quality. Three parallel tracks on separate branches, merged by the lead. The contract below is fixed; change it only by asking the lead.

## Fixed Contract (Already in `main`)

- **New intents** (`packages/session/src/types.ts`): `rollCheck`, `rollDice`, `chat`, `adjustHp`, `setCondition`, `saveToLibrary`, `removeFromLibrary`, `switchScene`, `spawnFromLibrary`, `setLighting`, `areaAttack`, `suppressiveFire`. The authority currently refuses them with `INVALID … isn’t supported yet`.
- **New events** (`packages/rules-core/src/events.ts`): `checkRolled`, `diceRolled`, `chatMessage`, `hpAdjusted`, `conditionSet`, `sceneChanged`, `areaResolved`. Any event may carry `audience` (player ids or `'gm'`); projection already drops it for everyone else. **Private GM rolls must set `audience: ['gm']`**, not just `visibility: 'gm'` (a PC subject would otherwise leak it).
- **State**: `SessionState.library = { maps, actors }`, GM-only, already stripped from player projections. `TacticalMap.lighting = { revealAll?, revealed? }`.
- **Signals** (`protocol.ts`): `{ t: 'signal', signal }` from any client; relay broadcasts `{ t: 'signal', from, signal }` to everyone else in the room, never logged. Kinds: `ping`, `cursor`, `measure`.
- **Assets API** (relay):
  - `POST /api/sessions/:sessionId/assets` with header `Authorization: Bearer <gmKey>`, body = raw bytes, `Content-Type` one of `image/webp`, `image/png`, `image/jpeg`. Max 8 MB. Origin rules as for session creation.
  - Stored at `DATA_DIR/assets/<sessionId>/<sha256>.<ext>` (memory store keeps them in a Map). Returns `201 { url: '/u/<sessionId>/<sha256>.<ext>' }`; same bytes → same URL.
  - `GET /u/<sessionId>/<file>` serves it with `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`. Validate the filename strictly (`^[a-f0-9]{64}\.(webp|png|jpg)$`). Per-session quota 200 MB.
  - CSP `img-src 'self' data: blob:` already allows these.
  - Client downsizes before upload: maps ≤ 4096 px on the long side, portraits 256 × 256 WebP (canvas).

## Tracks and File Ownership

| Track | Owns (may edit freely) | May touch lightly |
|---|---|---|
| **A: Engine and Relay** | `packages/**`, `apps/relay/**` | — |
| **B: Prep Tools (Editors)** | `apps/web/src/editors/**` (new), `apps/web/src/assets.ts` (new), `apps/web/src/data/**` (new) | `App.tsx` (add a shell with Table / Maps / Characters tabs), `net.ts` (add `uploadAsset`) |
| **C: Table Experience** | `apps/web/src/Table.tsx`, `MapView.tsx`, `tactics.ts`, `narrate.ts`, `styles.css`, `apps/web/src/table/**` (new) | `net.ts` (signals, chat), `demo.ts` |

Rules for everyone: RED Core rules only (flag interpretations in `docs/rules-verification.md`); Chicago headline caps for UI labels, sentence case for sentences; no RTG/CDPR art or text; no full RTG NPC stat blocks; tests for logic; `npm test` and `npm run typecheck` green before the final commit; commit messages end with the session attribution lines.
