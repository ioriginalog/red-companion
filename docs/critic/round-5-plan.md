# Critic Loop: Round 4 Result and Round 5 Plan

Round 4: **7/10**. Rules 7, Play Loop 7, Features 7, UX 7, Reliability and Security 6, Code 8, Compliance 8.

## Round 4 Defects

1. **Major:** `endTurn` skipped a required Death Save. **Fixed by the lead in 9283c06** (players refused with DEATH_SAVE_FIRST; End Turn disabled; GM may still skip as referee; test added).
2. **Major (phone):** the Death Save prompt hides in the collapsed bottom sheet; the dock shows a normal Turn (`table/panels.tsx` Prompts, `layout/ActionBar.tsx`).
3. **Major (leak):** GM ruler drags and Alt-click pings broadcast to every player even from fogged squares (`MapView.tsx` ~280–333, `net.ts` `signal()`, relay `onSignal`).
4. **Minor:** the relay's GM-offline queue is memory-only; a relay restart drops queued actions silently, the player's queue count resets with no notice, and a stale "Queued" toast stays.
5. **Minor (landscape 844×390):** the target-chip strip covers about a quarter of the map; chat input and Send are clipped.
6. **Minor:** players can't see where a scattered blast lands during "Blast Incoming" (no landing square or area drawn).
7. **Minor:** controls enabled when they can't work: "Nearest" does nothing silently with no enemy in the actor's own LOS (hint still says click an enemy); Jack In enabled after a Meat Action then refused; Virus offered on a floor that isn't the lowest.
8. **Minor (a11y):** phone Sheet STAT tiles are dim grey on navy and read as disabled.
9. **Minor (rules data):** Bloodhound ICE says it follows runners between floors but the engine never chases; Facedown allowed against an unseen NPC (no LOS check).
10. **Minor (docs):** rules-verification "Not Built Yet" lists built features; ADR names `@cprc/app` and is still "Proposed"; README compliance checklist unchecked though the disclaimer ships.
11. **Nit (CMOS):** sentence-case aria-labels ("Join code", "Your name", "Your sessions on this device", "Session export or GM backup file", "Confirm forgetting"); "Zzlurker, Street Thug are on the map" missing "and"; shortcut descriptions mixed case; tooltip punctuation inconsistent; the home-screen disclaimer is a fragment ("Unofficial content provided under…") — use RTG's full required sentence.
12. **Nit:** cross-origin WebSocket upgrade returns 401 not 403; GM can't name an NPC in `/check` ("Unknown skill 'Enforcer COOL'").

Missing: light sources, darkness levels and per-token vision; NET Prep is form-only (no map-picked access points, no floor tree, no run overview); no GM drawing/annotation tools or persistent templates; shields, human shields, vehicles, drugs, weapon quality. Code: ~209 inline styles; one 695 kB client chunk.

## Round 5 Tracks and Ownership

| Track | Owns | Work |
|---|---|---|
| **S5: Signals, Queue, Docs** | `apps/relay/**`, `apps/web/src/net.ts`, `packages/session/src/protocol.ts`, `README.md`, `docs/ADR-001-architecture.md`, `docs/rules-verification.md` (doc reconciliation only) | 3 (relay-side filtering of GM signals by each player's vision + GM ping/ruler privacy toggle, default private for fogged cells; e2e assertion), 4, 10, 12 (403) |
| **U5: UX and Copy** | `apps/web/src/{Table.tsx,styles.css,narrate.ts,App.tsx,SessionMenu.tsx}`, `apps/web/src/table/**` (not MapView), `apps/web/src/{editors,systems,extras}/**`, `vite.config.ts` | 2, 5, 7, 8, 11, 12 (/check names), code-split the bundle (lazy-load editors, NET, extras), cut inline styles in touched code |
| **V5: Vision and Annotation** | `apps/web/src/MapView.tsx`, `packages/session/src/tactical.ts`, `packages/rules-core/src/grid.ts`, new `packages/session/src/vision.ts` and `annotations.ts`, new `apps/web/src/map/**` | 6 (blast/scatter overlay for players during area prompts), light sources and darkness levels (bright/dim/dark squares, light radius, per-token vision incl. Low Light/IR cyberware), redaction-safe projection of lights and vision, GM drawing tools (persistent lines, shapes, text, GM-only or shared) |
| **G5: Gear and NET Prep** | `packages/rules-core/src/{net/**,ammo,wield,cover}.ts` + new `{shields,quality,drugs,vehicles}.ts`, `packages/session/src/{netrun,netrun-types,systems,extras}.ts`, `apps/web/src/netrun/**` | 7 (NET parts: Jack In/Virus availability), 9, NET Prep visual editor (floor tree, access points picked on the map, live run overview), shields and human shields, weapon quality, drugs, basic vehicles (SDP, seats, speed, ramming/vehicle attacks where confirmable) |

Shared files (`types.ts`, `authority.ts`, `events.ts`, `validate.ts`, `projection.ts`, indexes): tiny edits, no track markers in comments; every new event type gets a redaction fixture; every new intent validates its payload with hostile tests. Chicago style; statuses in `docs/rules-verification.md`; `npm run build && npm test && npm run typecheck && npm run e2e` green before the final commit.
