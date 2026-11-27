# Critic Loop Status (Stopped After Round 6)

Independent critic grades against `docs/critic-rubric.md`. The loop stopped because two rounds in a row didn't raise the overall grade.

| Round | Overall | Rules | Play Loop | Features | UX | Reliability and Security | Code | Compliance |
|---|---|---|---|---|---|---|---|---|
| 1 | 4 | 5 | 6 | 5 | 6 | 3 | 6 | 7 |
| 2 | 5 | 7 | 6 | 6 | 7 | 3 | 7 | 7 |
| 3 | 5 | 7 | 5 | 6 | 7 | 4 | 6 | 7 |
| 4 | 7 | 7 | 7 | 7 | 7 | 6 | 8 | 8 |
| 5 | 7 | 8 | 8 | 7 | 7 | 6 | 8 | 9 |
| 6 | 7 | 8 | 7 | 8 | 7 | 6 | 7 | 8 |

## Fixed After the Round 6 Grade

- Roster Merge kept the wrong seat (inverted arguments); test corrected.
- Fixed Humanity Loss uses the book's rounding (1d6 → 3, 3d6 → 10).
- The relay exits within 5 s on SIGTERM despite keep-alive connections, and exits on listen errors.

## Open Items From Round 6 (Most Important First)

1. **Name spoofing:** a stranger joining under an existing name can chat as that player before the GM answers the seat request; "Keep Them Separate" leaves two players with the same name; Cyrillic look-alikes and bidi characters aren't folded for player names (only for "GM"). Fix: fold look-alikes/format characters in `nameKey` for every name, require unique names, block chat from unresolved seat requests.
2. **Small leaks:** initiative `tiebreaks` reveal a hidden actor with the same total; Facedown and Grab send the NPC's natural die and total; the first GM-only drawing sends players an empty map patch; the "Unknown Contact Acting" slot's position can reveal hidden actors separated by visible ones.
3. **Robustness:** a 5,000-deep nested intent crashes `JSON.stringify` in the relay's `onPlayer` and is dropped silently; intents sent while a socket is being replaced are lost without notice; the log stores raw player intents including junk fields.
4. **Offered-then-refused actions:** the watch prompt offers a weapon a one-armed character can't use; players see the full shield/drug catalog with active buttons when they carry none; when a medic selects a dying ally the big Fire button targets the ally while Stabilize hides under More.
5. **Place Vehicle:** the hint says click a square but the main map moves the acting NPC; placement only works in a small picker that isn't keyboard-usable.
6. **Rules:** "Rest Everyone" also heals hostile NPCs.
7. **UX:** Sheet Skills grid wraps totals onto their own row; landscape phone truncates the queued toast; touch tooltips stick; a relay outage shows "GM Offline" instead of "Connection Lost"; players waiting on a seat request get no notice on some paths.
8. **Data:** exports keep `/u/<old session>/…` image URLs without the images, so importing onto another relay loses map art.
9. **Chicago nits:** a sentence toast in headline caps; lowercase parentheticals inside headline-style labels ("On the Street (no healing)"); two headings off the condensed uppercase style; light labels are 1-based while cells are 0-based.
10. **Missing systems:** vehicle chases and collision numbers; targeting vehicle occupants; rubble isn't stored on the map (late joiners don't see it).
