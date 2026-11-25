# Critic Loop: Round 2 Result and Round 3 Plan

Round 2: **5/10** (capped by Reliability and Security 3). Rules 7, Play Loop 6, Features 6, UX 7, Reliability 3, Code 7, Compliance 7. Player frames held no hidden NPC stats, journal notes, others' whispers, private GM rolls or unrevealed NET floors.

## Round 2 Defects

1. **Blocker:** a 600 KB frame before hello crashed the relay (no `ws.on('error')`). **Fixed by the lead in 54d192b** (socket terminated, process guards, regression test).
2. **Major:** the per-IP hello lockout blocks valid GMs and players (10 bad join codes → LOCKED for everyone on that IP for 5 min, checked before keys/tokens); client deletes `nsc.lastJoin` on LOCKED.
3. **Major:** actors added mid-encounter never enter initiative; no delay/hold.
4. **Major:** a missed explosive emits "GM places it" but there's no intent or UI to place the scatter and resolve the blast; narration after a miss is wrong (`grid-area.ts`, `narrate.ts`).
5. **Major:** the client never sends `attackCover`; cover can only be damaged by blasts.
6. **Major:** player reload wipes log and chat (welcome has no feed); GM reload loads only the last 60 entries (`net.ts` `slice(-60)`).
7. **Major (rules):** a netrunner can't move to an unrevealed floor without Pathfinder; RED doesn't require Pathfinder to descend (`NetPanel.tsx` FloorTree, netrun rules).
8. **Minor (rules):** cyberware data: Neural Link / Interface Plugs HL should be 2d6; Targeting Scope modeled as a smartlink (see research below for the real Smart ammo rule).
9. **Minor (UX):** players don't learn that armor stopped a hit (event is GM-only); a "no effect" line leaks nothing.
10. **Minor (UX):** phone: Fit leaves ~16 px tokens; with the sheet open the map is hidden while the panel says "Tap an enemy"; Fire only via Nearest; "Now" badge clipped.
11. **Minor (UI):** launcher NPCs show Single/Aim modes; "Improved Smart" shows with the 2070s toggle off.
12. **Minor:** players can't chat while the GM is offline ("The GM is offline").
13. **Minor:** GM offline queue lives only in memory (ADR promises IndexedDB).
14. **Minor (leak):** players' initiative strip shows one "?" per unseen hostile, revealing ambusher count and position.
15. **Minor (compliance):** starter Programs use RTG names with Core values (Worm, See Ya, Eraser, Speedy Gonzalvez, Armor, Shield, Sword, Banhammer) and are described as "original placeholders" (`net/data.ts`).
16. **Nit (CMOS):** "New From Image" (MapEditor.tsx 179, 265), "Add ICE From a Template" (NetArchitectureEditor.tsx 243), "Played By" (CharacterEditor.tsx 217) → lowercase the preposition; "Kevlar" with no ® note.
17. **Nit:** the GM bar shows "2 Online" while the GM is offline.

Missing features named: initiative add/remove/delay; scatter and shoot-cover; persistent history; phone-first combat; Martial Arts moves, Grab/Choke/Throw, Facedowns, vehicles, the other eight Role Abilities; larger cyberware and gear catalog (thrown grenades missing from the weapon list).

## User Rulings and Research

- `docs/critic/user-rulings.md`: hands per weapon (one-handed: Medium/Heavy/Very Heavy Pistol, SMG, Heavy SMG, Light/Medium Melee; everything else two-handed), fire damage ignores armor, Damage Deflection after armor, implement Improved Smart Ammo, use the book's Humanity Loss values.
- `/home/claude/research/r3-smart-ammo-humanity.md` (outside the repo): Smart ammo, Smartgun Link and Improved Smart Ammo mechanics; Humanity rules (max Humanity −2 per cyberware, fixed HL at creation, therapy table, cyberpsychosis at ≤ 0); the book's Humanity Loss table. **Book values must not be committed while the repo is public**: ship them as an importable data pack generated outside the repo.

## Round 3 Tracks and Ownership

| Track | Owns | Work |
|---|---|---|
| **R: Relay and Sync** | `apps/relay/**`, `packages/session/src/{projection,protocol,validate,reducer}.ts`, `apps/web/src/{net.ts,App.tsx,pwa.ts}`, `public/sw.js` | 2, 6, 12, 13, 14, 17 |
| **P: Play Loop** | `packages/session/src/{authority,grid-area,netrun,netrun-types,handouts}.ts`, `packages/rules-core/src/{area,attack,damage,initiative}.ts`, `packages/rules-core/src/net/**` except `net/data.ts`, `apps/web/src/table/**` panels and prompts, `narrate.ts`, `apps/web/src/netrun/**` | 3, 4, 5, 7, 9, 11 |
| **M: Mobile and Map UX** | `apps/web/src/styles.css`, `MapView.tsx`, `Table.tsx`, new `apps/web/src/table/layout/**` | 10 and a phone-first combat layout; camera follows the acting token; general polish |
| **D: Data, Rules and Compliance** | `packages/rules-core/src/{cyberware,ammo,wield,roles,healing,cover}.ts`, `packages/rules-core/src/data/**`, `packages/rules-core/src/net/data.ts`, `packages/session/src/systems.ts`, `apps/web/src/{editors,systems,data}/**` | 8, 15, 16, user rulings, Smart / Improved Smart ammo, Humanity rules, importable data pack, thrown grenades and gear |
| **X: Combat Extras and Roles** | new `packages/rules-core/src/{grapple,martial,facedown,roles-extra}.ts`, new `packages/session/src/extras.ts`, new `apps/web/src/extras/**` | Grab/Choke/Throw, Martial Arts special moves, Facedowns, the other Role Abilities as usable tools |

Shared files (`types.ts`, `authority.ts` delegating cases, `events.ts`, index exports): tiny, marked `// --- Round 3 <Track> ---` blocks. Each track validates its own payloads with hostile tests. UI from D and X is exposed as components; say where to mount them (P and M own the Table). Rules: RED Core, statuses in `docs/rules-verification.md`, no verbatim text, no RTG stat blocks or Core value tables in the repo, Chicago style. `npm run build && npm test && npm run typecheck` green before the final commit.
