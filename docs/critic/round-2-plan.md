# Critic Loop: Round 1 Result and Round 2 Plan

Round 1 (independent critic, rubric in `docs/critic-rubric.md`): **4/10**. Rules 5, Play Loop 6, Features 5, UX 6, Reliability and Security 3, Code 6, Compliance 7. Evidence screenshots were in `/tmp/critic/`.

## Round 1 Defects (Numbered for Reference)

1. **Blocker:** players can send `situational` modifiers and `gmDv` on rangedAttack/meleeAttack/stabilize; `value: 100` forced a hit on a fumble (authority.ts passes them through).
2. **Blocker:** non-numeric modifier values are accepted and corrupt the permanent log (`"total":"21-2abc"`); `sumModifiers` in rules-core checks.ts.
3. **Major:** GM actions while the socket is down are applied locally, never sent, then discarded by `fetchLog` on reconnect (net.ts).
4. **Major:** fog leaks: player projection sends every actor (real ids, wound state, conditions, injuries, Turn order positions) for unseen hostiles; template spawns get revealing ids (`corporate-security-1`); NPC `ammoSpent` events and `pending.spec` (damage dice) reach players.
5. **Major:** `clientIp` trusts the first `X-Forwarded-For` entry (session-creation and hello lockout bypass); default `ALLOWED_ORIGINS='*'` accepts any Origin.
6. **Major:** on a phone, the expanded bottom sheet covers End Turn.
7. **Minor:** page reload drops a player to the home screen (no auto-resume).
8. **Minor:** a player with two characters sees "Waiting for the GM to give you a character" when no Turn is active (Table.tsx `ownIds`).
9. **Minor:** `/check Handgun dv 15` parses "Handgun Dv 15" as a skill at level 0; unknown skills silently count 0 (table/commands.ts).
10. **Minor:** `/w PlayerName` fails; only character names work (players have no player directory).
11. **Minor:** reopening the GM tab replays every historical floater/effect at once.
12. **Minor:** adjacent token labels overlap; duplicate NPC names truncate identically; Maps tab zoom/size controls overflow the header at 1600 px.
13. **Minor:** the dodge prompt doesn't show the range DV or the odds.
14. **Minor (rules):** area dodges are automatic (no defender choice); Grenade Launchers offer Aim options; a blast can't target a cover square; Broken/Dismembered Arm don't restrict weapon use.
15. **Nit (compliance):** "Remove From Session" → "Remove from Session"; "Handgun Dv 15"; log lowercases injury names; the disclaimer is a fragment and appears only on the home screen.

Missing features that cap the grade: Netrunning (NET Architecture, run sequence, Programs, ICE, Interface); cyberware and Humanity; Role Abilities; healing and recovery over time; cover with HP; grapples and Martial Arts moves; ammo types; weapon quality; handouts and shared notes / GM journal; offline PWA (service worker) and full session import; light sources; keyboard and screen-reader access to the map.

## Round 2 Tracks and File Ownership

| Track | Owns | Fixes / Builds |
|---|---|---|
| **S: Security and Reliability** | `packages/session/src/{authority.ts,projection.ts,protocol.ts,reducer.ts}`, new `packages/session/src/validate.ts`, `packages/rules-core/src/checks.ts`, `apps/relay/**`, `apps/web/src/net.ts`, `apps/web/src/App.tsx`, service worker + session import | 1, 2, 3, 4, 5, 7; player directory for 10 (relay sends `{playerId,name}` list to players); offline PWA shell; GM session import (upload an exported log to a new session) |
| **U: Table UX and Access** | `apps/web/src/table/**`, `Table.tsx`, `MapView.tsx`, `styles.css`, `narrate.ts`, `tactics.ts` | 6, 8, 9, 10 (UI side), 11, 12 (map labels), 13, 15 (table copy), keyboard and screen-reader access to the map, handouts and shared notes panel UI |
| **N: Netrunning** | new `packages/rules-core/src/net/**`, new `packages/session/src/netrun.ts`, new `apps/web/src/netrun/**` | NET Architecture builder (GM), run sequence, NET Actions from Interface, Programs, Black ICE (GM-entered stats; only original generic ICE shipped), Netrunner view; Edgerunners 2070s options behind a toggle where public sources allow |
| **K: Systems and Rules** | new `packages/rules-core/src/{cyberware,roles,healing,cover,ammo}.ts`, new `packages/session/src/systems.ts`, `packages/session/src/grid-area.ts`, `apps/web/src/editors/**`, new `apps/web/src/systems/**` | Cyberware and Humanity, Role Abilities (start with Solo Combat Awareness, Netrunner Interface rank, Medtech basics), healing over time and Critical Injury treatment, cover with HP (attack cover, destruction), ammo types, Broken/Dismembered Arm restrictions, area-dodge choice, blast on cover squares, no Aim options on launchers; 12 (Maps tab overflow) and 15 (editor copy) |

**Shared-file rule:** `packages/session/src/types.ts` (Intent union, types) and the `execute` switch in `authority.ts` will be touched by several tracks. Keep additions in clearly separated blocks (`// --- Track N ---` etc.) and put logic in your own module, delegating from a one-line `case`. N and K: validate your own intent payloads (types, integers, bounds) inside your handlers and include hostile-payload tests; S builds the generic validator for everything else. N and K expose UI as self-contained components (`NetPanel`, `SystemsPanel`, sheet sections) and list in the report where they should be mounted; the lead wires them into the Table.

Everyone: RED Core rules (flag interpretations in `docs/rules-verification.md`), no verbatim rulebook text, no full RTG NPC/ICE stat blocks, Chicago headline caps for labels and sentence case for sentences, tests for logic, `npm run build && npm test && npm run typecheck` green before the final commit, commit messages end with the session attribution lines.
