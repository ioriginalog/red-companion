# Critic Rubric: All-in-One RED VTT

The critic grades the whole product (engine, relay, web client) as a private, all-in-one virtual tabletop for running Cyberpunk RED with a 2077 setting. Grade what exists and works, not what the docs promise.

## Scale (Overall and per Category)

- **10:** As good as a polished commercial VTT for this scope (think Foundry with a mature RED system). A GM could run a full campaign night with no workarounds. No defect worse than a nit.
- **8–9:** Ready for regular play. A few minor defects or gaps with easy workarounds.
- **6–7:** Playable for a test session. Noticeable gaps or friction that a GM would hit in one evening.
- **4–5:** Demo quality. Core loop works; important features missing or unreliable.
- **1–3:** Broken or unusable for play.

The overall grade cannot exceed the lowest category by more than 2.

## Categories

1. **Rules Fidelity:** RED Core (2045 era) mechanics are correct; interpretations are flagged; nothing from 2020 or 2077 the video game leaks in. Covers combat, damage, armor, crits, death saves, healing, initiative, area attacks, cover, skill checks, and Netrunning.
2. **Core Play Loop:** a GM and 3–5 players can run an encounter end to end on desktop and phone without the GM doing bookkeeping by hand.
3. **VTT Feature Completeness:** maps, tokens, fog and lighting, measurement, chat and dice, character sheets, prep tools (map and character editors, library, scenes), handouts or notes, session persistence and recovery, import/export.
4. **UX and Visual Polish:** matches the neon mockup direction; clear affordances; feedback for every action; responsive on phone and tablet; accessible (keyboard, contrast, labels, reduced motion).
5. **Reliability and Security:** reconnects, GM tab closing, concurrent actions, malformed input, information leaks to players (hidden NPC data, fog), upload safety, origin checks, performance with a full map.
6. **Code Quality and Tests:** structure, types, test coverage of rules and protocol, no dead code, docs that match behavior.
7. **Compliance:** RTG Homebrew Content Policy (no verbatim rulebook text, no full RTG NPC stat blocks, disclaimer, no "Cyberpunk RED" in the app name), CDPR Fan Content Guidelines (non-commercial, no CDPR assets), Chicago Manual of Style in UI copy (headline caps for titles, labels, buttons and statuses; sentence case for sentences).

## Report Format (Keep Under 1,200 Words)

1. Overall grade and one-line verdict.
2. Table: category, grade, one-line reason.
3. Defects, most severe first. Each: severity (blocker / major / minor / nit), category, what happens, how to reproduce, file or area.
4. Missing features that hold the grade down, most important first.
5. What would raise the grade by one point, concretely.
