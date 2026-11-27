# Critic Loop: Round 5 Result and Round 6 Plan

Round 5: **7/10**. Rules 8, Play Loop 8, Features 7, UX 7, Reliability and Security 6, Code 8, Compliance 9. The critic estimates its fix list below lifts Reliability and Features to 8 and the overall grade to 8.

## Round 5 Defects

1. **Major (leak):** area-attack pendings carry the hidden attacker's full check to players (`attack.baseBreakdown`: REF, skill, natural roll) while `attackerId` is `hidden`. `systems.ts` `projectPendingForPlayer` spreads `...pending`; `awaitingScatter` in `projection.ts` passes `attack` through. Players should get at most `{ total }`.
2. **Major (leak):** every log entry reaches every player with `seq`, `by` and `intentType` even when all events are filtered: two empty `endTurn` entries while two unseen hostiles act = a count; a player's private `/gm /r 3d6` reaches other players as `{by:"player:…", intentType:"rollDice", events:[]}`; whispers likewise. (`projectEntry` base fields; relay `broadcastEntries`.) Fix: send players nothing for entries with no visible events and no visible state change (client must tolerate seq gaps), and never send `by`/`intentType` for entries whose content is hidden. README's "never a count" claim must become true.
3. **Major (feature):** terrain is never drawn on the Table: `MapView.tsx` (~547) draws only the background or a flat rect; walls/cover from `cells` never appear; destroyed cover still shows as painted crates on the art.
4. **Major (reliability):** player slots can be exhausted: each hello with a new name makes a permanent identity (7 hellos → 12 players → `SESSION_FULL`), and the GM has no kick/merge (`relay.ts` `onHello`).
5. **Minor (leak):** rejection messages name hidden NPCs ("You can't speak as Lieutenant", "You don't control Lieutenant").
6. **Minor:** a player named "GM" is indistinguishable from the GM in chat.
7. **Minor (UX):** GM Vehicles row overflows the side panel at 1600×1000 (allegiance select and Place Vehicle beyond x 1600).
8. **Minor:** Start of Turn card goes stale (healed from −3 to 27 HP still says "rolls a Death Save before acting"); `table/panels.tsx` ~145 looks back to the last `endTurn` in the feed, which omits event-less entries.
9. **Minor (UX):** at 390×844 players can't see the GM is offline (desktop shows "GM Offline").
10. **Minor (UX):** misleading copy/controls: on a hostile's Turn the GM reads "The party can see enemies, but none is in Street Ganger's line of sight"; disabled Grab shows "Grab · 15%" when not adjacent; Equip Shield and Take a Dose stay enabled after the Action is spent; local chat errors stay pinned below newer log lines.
11. **Minor (rules/authority):** players can equip any catalog shield or take any drug without owning it.
12. **Nit:** players receive the full terrain string and background including unexplored areas; Black ICE ATK breakdowns go to every player; a player's chat placeholder suggests `/check … (Vex)` for a character they don't control; phone zoom buttons sit over tokens; help parentheticals like "(A Unique Prefix Works)" should be sentence case.

## Round 6 Tracks

| Track | Owns | Work |
|---|---|---|
| **A6: Redaction, Relay, Authority** | `packages/session/**`, `apps/relay/**`, `apps/web/src/net.ts`, `apps/web/e2e/**`, README | 1, 2, 4 (GM roster: remove, rename, merge players; reclaim a seat; idle unclaimed identities don't count toward the cap), 5, 6 (reserve "GM" and look-alikes; chat renders the GM distinctly), 11, 12 (mask unexplored terrain cells for players; Black ICE breakdowns GM-only), redaction tests that would have caught 1 and 2, E2E assertions for each |
| **B6: Table UX** | `apps/web/src/**` except net.ts (MapView, Table, table/**, styles, gear/netrun/extras UI) | 3 (terrain layer: walls, cover by material with HP state, destroyed cover, difficult ground; toggleable; consistent with the art), 7, 8, 9, 10, 12 (placeholder, phone zoom buttons, help case); GM roster UI for A6's player management intents |
