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
| Head Critical Injuries | All 11 rows from **one** community chart. ⚠ Highest-risk data in the pack. | Secondary |
| Armor table | Leathers 4, Kevlar 7, Light AJ 11, Bodyweight 11, Medium AJ 12 (−2), Heavy AJ 13 (−2), Flak 15 (−4), Metalgear 18 (−4). | Secondary |
| Shotgun Shells | DV13, 3d6 to every target within 6 m/yds in front, rolled once; no Aimed Shot. | Secondary |
| Explosives | 10 × 10 m/yds; damage rolled once; miss = GM scatters within area; cover protects only if the blast can't destroy it. | Secondary |
| Suppressive Fire | 10 rounds; WILL + Concentration vs REF + Autofire; losers move to cover. | Secondary |
| Initiative | REF (after armor) + 1d10; tied combatants reroll until settled. | Easy Mode |

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

## Not Built Yet

Martial Arts special moves, Grab/Choke/Throw, shields, human shields, ammo types (AP, incendiary, etc.), weapon quality, cyberware effects, Solo/Medtech Role Abilities, Facedowns, vehicles, Netrunning, re-bleed automation for Broken Ribs/Foreign Object, Spinal Injury lost-Action tracking.
