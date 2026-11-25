# Combat Core: Rules Verification Matrix

Unofficial. Built without the Core Rulebook in hand, so every rule carries a status. **Before relying on the engine at the table, have someone with the book check every row not marked Easy Mode or Errata.**

Status key: **Easy Mode** = matches the free Easy Mode PDF · **Errata** = matches RTG errata · **Secondary** = consistent across community references, unchecked against the book · **Interpretation** = book silent or ambiguous; our ruling.

## Rules

| Rule | Engine Behavior | Status |
|---|---|---|
| Skill Check | STAT + Skill + 1d10 + mods. Natural 10 adds one d10; natural 1 subtracts one d10; never chains. | Easy Mode |
| Ties | Attacker must beat the DV; ties go to the defender. Also applied to DV checks like Stabilization. | Easy Mode |
| Range DV table | 8 rows × 8 bands; `null` = can't attack (Core p.173). | Secondary |
| Autofire DV table | SMG 20/17/20/25/30, AR 22/20/17/20/25, max 100 m/yds. | Errata |
| Autofire damage | 2d6 × min(margin, cap). Cap 3 for SMG/Heavy SMG, 4 for AR. 10 rounds; no Aimed Shot. Reproduces the Core worked example (40 damage). | Secondary |
| Dodging ranged | Only REF 8+ (after armor penalty); DEX + Evasion + 1d10 replaces the range DV, even if lower. | Secondary |
| Aimed Shot | −8, one attack regardless of ROF. Head: through-damage × 2 vs head SP. Held Item: drop on penetration. Leg: Broken Leg on penetration (if not already broken). | Secondary |
| Melee weapons | Count ceil(SP / 2) (Core p.175 errata example). Ablate the real SP. | Errata |
| Brawling | Full SP. Damage by BODY: ≤4 1d6, 5–6 2d6, 7–10 3d6, 11+ 4d6. Two attacks. | Secondary |
| Martial Arts | BODY damage; counts half SP. Special moves not built yet. | Secondary |
| Armor | Highest SP in a location counts; every piece in that location ablates by 1 when damage gets through. | Secondary |
| Critical Injury trigger | 2+ sixes on damage dice. Happens even if armor stopped all damage. | Secondary |
| Crit bonus damage | +5 to HP; ignores armor, no ablation, not multiplied by headshots. Reroll injuries already owned. | Secondary |
| Mortally Wounded hit | Damaging hit on someone already Mortally Wounded: one extra Critical Injury and Death Save Penalty +1. Confirmed in spirit by an RTG dev blog. | Secondary |
| HP | 10 + 5 × ceil((BODY + WILL) / 2) (Core p.79). Matches Easy Mode sheet (BODY 8, WILL 3 → 40). | Secondary |
| Seriously Wounded | HP **less than** ceil(max / 2). ⚠ Easy Mode says "equal to or less than half"; differs only at exactly half with even max HP. | Secondary |
| Wound penalties | Seriously −2 to all Actions; Mortally −4 and −6 MOVE (min 1). | Easy Mode |
| Death Save | 1d10 + penalty, live if **under** BODY; natural 10 always fails; +1 penalty per roll; one fail = dead. | Easy Mode |
| Stabilization | TECH + First Aid/Paramedic vs 10/13/15. Mortally → 1 HP and Unconscious. Resets accumulated penalty. | Easy Mode |
| Body Critical Injuries | All 11 rows. | Easy Mode |
| Head Critical Injuries | All 11 rows from one community chart; a second pass found the rows consistent across sources **except Concussion's Quick Fix and Treatment DVs**, which differ between references. ⚠ Confirm Concussion in the book. | Secondary |
| Armor table | Leathers 4, Kevlar 7, Light AJ 11, Bodyweight 11, Medium AJ 12 (−2), Heavy AJ 13 (−2), Flak 15 (−4), Metalgear 18 (−4). | Secondary |
| Shotgun Shells | DV13, 3d6 to every target within 6 m/yds in front, rolled once; no Aimed Shot. | Secondary |
| Explosives | 10 × 10 m/yds; damage rolled once; miss = GM scatters within area; cover protects only if the blast can't destroy it. | Secondary |
| Suppressive Fire | 10 rounds; WILL + Concentration vs REF + Autofire; losers move to cover. | Secondary |
| Initiative | REF (after armor) + 1d10; tied combatants reroll until settled. | Easy Mode |

## Tactical Map (2026-11)

| Rule | Engine Behavior | Status |
|---|---|---|
| Grid scale | 1 square = 2 m/yds. Range is measured on the grid; the client's distance is ignored when both tokens are on the map. | Secondary |
| Diagonals | Cost 1 square (Chebyshev distance), for both movement and range. | Interpretation |
| Movement | Move Action = MOVE squares. Running spends the Action for MOVE more. Can't end on a token; can pass allies, not enemies; can't squeeze diagonally between two blockers. | Secondary |
| Turn economy | One Action per Turn. A ROF 2 weapon gets two attacks with the same weapon for that Action; Aimed Shots and Autofire take the whole Action. Reload, Stabilize and Watch use the Action. Enforced for players; the GM is recorded but never refused. | Secondary |
| Line of sight | Ray between square centers. A ray exactly through a corner is blocked only if both squares beside it are opaque. | Interpretation |
| Cover | Binary, as in RED: no line of sight = no attack. No partial-cover modifier. The GM can rule a target visible. | Secondary |
| Melee and Stabilize reach | Adjacent square (2 m/yds). | Secondary |
| Fog of war | The party (PCs and allied NPCs) shares one field of view. Hostile tokens outside it are hidden from players; names stay hidden until first seen. Vision is 360°. | Interpretation |
| Facing | None. RED has no facing rules; cones in the UI are for targeting and watches only. | Secondary |
| Explosive blast | 10 × 10 m/yds = 5 × 5 squares centered on the target square. Caught if in the blast with line of sight to the center square; anything opaque in between protects (no cover HP on the map, so cover survives). A miss scatters; the GM places it (Core has no scatter table). | Interpretation |
| Shotgun Shells on the grid | Every token (friend or foe) within 3 squares (6 m/yds) in a 90° cone toward the aimed square, in the shooter's line of sight. | Interpretation |
| Area dodges | Everyone in the area who can dodge (REF 8+) does, automatically: in the engine a failed dodge costs nothing. | Interpretation |
| Thrown grenades | DEX + Athletics vs the Grenade Launcher row; 6d6 unless the item sets its own damage dice; one grenade per throw. | Secondary |
| Suppressive Fire on the grid | Opposing tokens (not neutrals) within 25 m/yds (12 squares) and the weapon's Autofire range, in the shooter's line of sight. Needs 10 rounds; takes the Action. | Secondary |
| Area attacks and the Turn | Every area attack and Suppressive Fire takes the whole Action. | Secondary |
| Free checks | STAT + skill + 1d10 + standing modifiers (wound penalties) vs an optional DV; ties fail. Not tied to the Turn or the Action: the GM rules what a check costs. | Easy Mode |
| GM HP edits | Healing caps at max HP; damage has no floor; HP edits never kill on their own (only Death Saves do). | Interpretation |
| Scene switches | Allowed mid-encounter; the encounter, Turn order and actors carry over; watches end. | Interpretation |
| Watch | **House rule, not RED Core.** Spend the Action to watch a 90° cone (30°–180°) until your next Turn. The first opposing token to step into a visible watched square stops there and the watcher may attack out of Turn, or hold fire. | House Rule |

## Netrunning (2026-11)

Built from community references (not the Core Rulebook). Starter Programs and Black ICE are original placeholders with this tool's own numbers; no RTG ICE or Program stat blocks or text are reproduced. The GM edits everything in NET Prep.

| Rule | Engine Behavior | Status |
|---|---|---|
| NET Actions per Turn | By Interface rank: 1–3 → 2, 4–6 → 3, 7–9 → 4, 10 → 5. | Secondary |
| Meat vs NET Actions | A runner's Turn is a Meat Action **or** their NET Actions, plus the Move Action. Players are held to it; the GM is recorded, never refused. | Secondary |
| Jack In / Jack Out | Each costs 1 NET Action. Jack In needs an access point within 6 m/yds (3 squares) with line of sight. Without a map, the GM rules. | Secondary |
| Unsafe Jack Out | Forced out (GM), or jacking out after leaving access range: every live Black ICE the runner met applies its effect (damage rolled, no attack roll). | Secondary |
| Floor DVs | Basic 6, Standard 8, Uncommon 10, Advanced 12 (GM can set any DV). | Secondary |
| Floors and branches | Tree of floors; you move one floor up or down per NET Action; you can't go below a Password until it's Backdoored. | Secondary |
| Backdoor, Eye-Dee, Control, Virus | Interface + Booster + 1d10 must beat the DV. Control and Virus raise GM prompts for what the runner does with them. Virus only on a lowest floor. | Secondary |
| Pathfinder | Reveals floors below in breadth-first order, at most the check total, never past a Password whose DV beats the roll (that Password is shown). Shows what floors are, not their DVs. | Interpretation |
| Cloak | Check total becomes the DV to find the runner's traces. | Secondary |
| Scanner | Meat Action. Finds access points on the current map within (check total) squares of the runner. | Interpretation |
| Speed Check | On arrival, each live Black ICE: Interface + Speed Boosters + 1d10 vs ICE SPD + 1d10. The ICE strikes first on a tie or better. | Secondary (tie rule: Interpretation) |
| Black ICE attacks | ICE ATK + 1d10 vs Interface + 1d10; ties go to the runner. The GM triggers ICE attacks on the ICE's Turn. | Secondary (GM-triggered timing: Interpretation) |
| Runner attacks | Zap: Interface + 1d10 vs ICE DEF + 1d10, 1d6 REZ. Attacker Programs add their ATK and roll their damage; once per Round each. Demons defend with their Interface. | Secondary |
| Engagement | On a floor with live Black ICE or a live Demon, you can't move away; Slide (Interface + 1d10 vs PER + 1d10, once per Turn, not vs Demons), derez it, or jack out. | Secondary |
| Brain damage | Straight to HP, ignores armor, no Critical Injuries. Shield negates the first hit of a run; the best active Armor-type Defender reduces it (they don't stack). | Secondary (stacking: Interpretation) |
| Anti-program ICE | Damages the first running Program (then a ready one) and destroys it at 0 REZ. | Secondary (target choice: Interpretation) |
| Programs | Boosters stack; activating or stopping costs 1 NET Action; restarting a Derezzed Program costs 2 and restores REZ. Deck slots: Poor 5, Standard 7, Excellent 9. | Secondary |
| ICE state | Each runner's ICE state is their own and resets when they jack out safely. | Interpretation |
| 2070s Quickhacks (option) | Jack In to a visible target's neuroport within 50 m/yds (25 squares), 1 NET Action; the quickhack's effect is a GM prompt (the kit's tables aren't in the tool). Off by default. | Secondary (public summaries) |

Not built for Netrunning: rival netrunners fighting each other, Demon turns (GM runs them), Relentless ICE following the runner, the Edgerunners Mission Kit quickhack tables, and Improved Smart Ammo (a weapon option, not NET).

## Interpretations the GM Should Confirm

1. **Armor penalties don't stack.** Worst single penalty across all worn pieces.
2. **Quick Fix suppresses the whole Injury Effect**, including the Death Save line.
3. **"Damaged while Mortally Wounded"** means lost any HP to the attack (crit bonus included), checked against the state *before* the hit. The hit that drops you doesn't trigger it.
4. **Aimed Leg's Broken Leg** carries the normal +5 bonus damage.
5. **Dodging area attacks**: DEX + Evasion vs the attack total, ties to the defender.
6. **Thrown grenades**: DEX + Athletics vs the Grenade Launcher row.
7. **Initiative doesn't explode** on a natural 10 or 1 (toggle provided).
8. **New damage clears Stabilized** (healing restarts).
9. **Fractional distances round up** to the next whole m/yd.
10. **Melee Aimed Shots** are allowed.
11. **Defender who can't Evade** (Dismembered Leg, Unconscious): the GM must set the DV.
12. **HP can go negative** with no floor; only Death Saves kill.
13. **Shared vision vs. your own line of sight**: you can *see* a target a teammate spots, but you can only *shoot* it with your own line of sight.
14. **Difficult terrain** ('~' squares) costs 2 squares to enter. No demo map uses it yet.

## Not Built Yet

Martial Arts special moves, Grab/Choke/Throw, shields, human shields, ammo types (AP, incendiary, etc.), weapon quality, cyberware effects, Solo/Medtech Role Abilities, Facedowns, vehicles, re-bleed automation for Broken Ribs/Foreign Object, Spinal Injury lost-Action tracking.
