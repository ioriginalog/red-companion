# Critic Loop: Round 3 Result and Round 4 Plan

Round 3: **5/10**. Rules 7, Play Loop 5, Features 6, UX 7, Reliability and Security 4, Code 6, Compliance 7. Round 4 is a **hardening round**: fix what's broken, no new systems beyond what the critic named.

## Round 3 Defects

1. **Blocker:** reconnect loses player identity: after a socket drop the client resends the original `hello` without `playerToken` (net.ts saves the token at ~345 but `this.hello` is never updated; reconnects at ~262, ~382, ~426 reuse it). Players reappear as new, unassigned duplicates.
2. **Major (leak):** `initiativeRolled` keeps one `"hidden"` entry per unseen NPC (count and position leak) (projection.ts `redactEvent`).
3. **Major (leak):** `burning` event is public with `hpAfter` (NPC HP) (systems.ts ~382). Also check `rested` and every other event with HP.
4. **Major (leak):** `coverDamaged.byId` and `turnDelayed.after` aren't in `ID_KEYS` (real hidden ids reach players).
5. **Major:** no per-player intent rate limit: 2,000 chats all logged; GM client hit React #185 (max update depth) 37 times; at the 20,000 log cap every GM append fails (`LOG_FULL`), bricking the session.
6. **Major:** GM key never shown/exportable; Leave deletes it with one click; one GM session slot per browser; `/api/sessions/:id/export` has no client button.
7. **Major:** Martial Arts unusable from the editor (offers plain "Martial Arts"; engine reads `Martial Arts (Form)`).
8. **Minor (leak):** GM notes on PCs go to every player (notes are on the full sheet; the editor invites GM-only content).
9. **Minor:** before hello, malformed frames get an error but the socket stays open (40 × 480 KB junk accepted).
10. **Minor:** 10 bad join codes from a shared IP block new legitimate joins on that IP for 30 s at a time.
11. **Minor:** attack preview ignores grapple rules (two-handed rifle shown at 70% with no −2 while grappling).
12. **Minor:** "Add to Session" spawns tokens at map center (instantly spotted; spoils reinforcements).
13. **Minor:** blast template fires on one click, no confirmation.
14. **Minor:** stale state after the encounter ends (facedown banner persists; GM view shows the last Turn).
15. **Minor:** dodge prompt guesses the DV wrong ("~15 (typical)" vs real 20).
16. **Minor:** GM undo doesn't update players' logs.
17. **Minor:** phone chat doesn't stick to the newest message.
18. **Minor:** demo map cover squares don't line up with the crates in the art.
19. **Nit:** initiative portrait buttons have empty accessible names.
20. **Nit:** "Damage 1 + 2 × 4 = 12" reads as 1 + 8.
21. **Nit (CMOS):** "GM decides later", "Item to snatch (GM)" → headline caps; armor penalty uses "-2" not "−2"; Death Save log omits the roll.

Missing named: session export button and GM key backup, multiple GM sessions per browser; Martial Arts Form picker; players editing their own sheets/gear; automated crit effects (Spinal Injury lost Action, Broken Ribs / Foreign Object re-bleed) and speedware initiative (Kerenzikov); Black ICE and Demon turns; browser end-to-end tests for reconnect and redaction; exploration fog (map art for unexplored areas visible).
Code: 203 leftover `--- Track X ---` markers (lead removes after merge), stale docs.

## Round 4 Tracks and Ownership

| Track | Owns | Work |
|---|---|---|
| **H1: Relay, Sync, Persistence** | `apps/relay/**`, `apps/web/src/{net.ts,persist.ts,App.tsx,pwa.ts}`, home screen, new `apps/web/e2e/**` | 1, 5 (relay side + GM client render storm), 6, 9, 10, 16 (relay/net side: tell players on truncate), browser E2E suite for reconnect, redaction and offline |
| **H2: Redaction and Validation** | `packages/session/src/{projection,validate,protocol}.ts`, session types for notes | 2, 3, 4, 8 (split `notes` into player-visible `notes` and GM-only `gmNotes`), exhaustive per-event-type redaction test, typed validation of all actor/weapon/cyberware/gear fields |
| **U4: UX and Editors** | `apps/web/src/{table/**,Table.tsx,MapView.tsx,styles.css,narrate.ts,editors/**,systems/**,extras/**,netrun/**,demo.ts}` | 7, 8 (editor field), 11, 12, 13, 14, 15, 16 (UI side), 17, 18, 19, 20, 21, exploration fog for players, players editing their own notes and gear |
| **R4: Rules Automation** | `packages/rules-core/**`, `packages/session/src/{authority,systems,netrun,netrun-types,extras,playloop,grid-area,handouts,tools,helpers,tactical}.ts` | crit effects automation, speedware initiative, Black ICE and Demon turn helpers, grapple-aware attack preview helper for U4, remaining rules gaps |
