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
| Martial Arts | BODY damage; counts half SP. Special Moves: see Grapples, Martial Arts, Facedowns and Role Abilities below. | Secondary |
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
| Armor table | Leathers 4, Kevlar® 7 (a DuPont trademark; game term only), Light AJ 11, Bodyweight 11, Medium AJ 12 (−2), Heavy AJ 13 (−2), Flak 15 (−4), Metalgear 18 (−4). | Secondary |
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
| Explosive blast | 10 × 10 m/yds = 5 × 5 squares centered on the target square (which may be a cover square). Walls always shield. Cover between the center and a target protects only if it survives: the toughest intact cover on the line must have more HP than the damage. Every cover square the blast reaches takes the damage. A miss scatters; the GM places it (Core has no scatter table). | Interpretation |
| Shotgun Shells on the grid | Every token (friend or foe) within 3 squares (6 m/yds) in a 90° cone toward the aimed square, in the shooter's line of sight. | Interpretation |
| Area dodges | Each target who can dodge (REF 8+) chooses before damage is rolled; the GM can resolve everyone left as dodging. | Secondary |
| Thrown grenades | DEX + Athletics vs the Grenade Launcher row; 6d6 unless the item sets its own damage dice; one grenade per throw. | Secondary |
| Suppressive Fire on the grid | Opposing tokens (not neutrals) within 25 m/yds (12 squares) and the weapon's Autofire range, in the shooter's line of sight. Needs 10 rounds; takes the Action. | Secondary |
| Area attacks and the Turn | Every area attack and Suppressive Fire takes the whole Action. | Secondary |
| Free checks | STAT + skill + 1d10 + standing modifiers (wound penalties) vs an optional DV; ties fail. Not tied to the Turn or the Action: the GM rules what a check costs. | Easy Mode |
| GM HP edits | Healing caps at max HP; damage has no floor; HP edits never kill on their own (only Death Saves do). | Interpretation |
| Scene switches | Allowed mid-encounter; the encounter, Turn order and actors carry over; watches end. | Interpretation |
| Late arrivals (Round 3) | The GM rolls a newcomer in with REF + 1d10 (the engine's initiative roll) and slots them by total; a tie with an existing slot goes to a d10 roll-off between those two only, so nobody else moves. Slotting before the current Turn means they act next Round. | Interpretation |
| Delay (Round 3) | **House rule, not RED Core** (we found no Delay or Hold Action in Core). On by default; the GM can switch it off. The acting character, before moving or acting, takes their Turn later this Round (after a chosen character, or last). The new position sticks for later Rounds. | House Rule |
| Missed explosives (Round 3) | A miss waits for the GM, who taps where it lands or rolls it: a random square in the 5 × 5 blast area around the aim point (never the aim square, never a wall). It then goes off there like a hit, dodges included, against the original attack total. Core leaves the landing spot to the GM. | Interpretation |
| Netrunner movement (Round 3) | A runner can go down to the next floor without Pathfinder; the floor reveals itself on arrival (a Password must be Backdoored first). Pathfinder still reveals floors ahead. Costs 1 NET Action. | Secondary |
| Armor stopped it (Round 3) | Players see "no effect" when a hit on an NPC does no HP damage; SP values stay hidden. | Interpretation |
| Watch | **House rule, not RED Core.** Spend the Action to watch a 90° cone (30°–180°) until your next Turn. The first opposing token to step into a visible watched square stops there and the watcher may attack out of Turn, or hold fire. | House Rule |

## Netrunning (2026-11)

Built from community references (not the Core Rulebook). Starter Programs (Lockpick, Cartographer, Ghostwalk, Quickstep, Static Padding, Decoy Shell, Cleaver, Needle) and Black ICE are original designs with this tool's own names and numbers; no RTG ICE or Program names, stat blocks or text are shipped. GMs who own the book can import its Programs as a rules pack. The GM edits everything in NET Prep.

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
| Engagement and chasing | Black ICE that has met a runner chases them: a runner engaged with live Black ICE may still move (1 NET Action), and every live ICE on the floor follows to the new floor (no new Speed Check for it). Passwords don't stop it. Only derezzing it, a Slide (Interface + 1d10 vs PER + 1d10, once per Turn, not vs Demons) or jacking out shakes it. ICE slid away from lies in wait where the chase ended; arriving there again sets off a new Speed Check. Unsafe Jack Out: every live ICE met bites, wherever it is now. Sources: community Player Handbook (Netrunning) and a community player reference. | Secondary |
| Chasing details | Followers move with the runner at once (not on the ICE's next action). A Slide leaves only the ICE slid past; other live ICE on the floor still follow. Demons don't chase, and leaving a Demon's floor is allowed. The starter Bloodhound no longer claims a special chase (all Black ICE chases); its original effect is now a GM prompt that the owner learns roughly where the runner's body is. | Interpretation |
| NET Action availability | One pure rule (`netAvailability`) used by the authority and the NetPanel, kept in lockstep by a test: Jack In needs a found access point within reach and no Meat Action this Turn; Virus only on a lowest floor; Backdoor, Eye-Dee and Control only on their floor kinds; Slide and Zap only while engaged; NET Actions per Turn. Disabled buttons show the reason. | Tooling |
| Brain damage | Straight to HP, ignores armor, no Critical Injuries. Shield negates the first hit of a run; the best active Armor-type Defender reduces it (they don't stack). | Secondary (stacking: Interpretation) |
| Anti-program ICE | Damages the first running Program (then a ready one) and destroys it at 0 REZ. | Secondary (target choice: Interpretation) |
| Programs | Boosters stack; activating or stopping costs 1 NET Action; restarting a Derezzed Program costs 2 and restores REZ. Deck slots: Poor 5, Standard 7, Excellent 9. | Secondary |
| ICE state | Each runner's ICE state is their own and resets when they jack out safely. | Interpretation |
| 2070s Quickhacks (option) | Jack In to a visible target's neuroport within 50 m/yds (25 squares), 1 NET Action; the quickhack's effect is a GM prompt (the kit's tables aren't in the tool). Off by default. | Secondary (public summaries) |

Not built for Netrunning: rival netrunners fighting each other, ICE that stops a runner moving at all (an effect of some book ICE; the GM can rule it), and the Edgerunners Mission Kit quickhack tables. (Demon Turns are built; see Automation.) (Improved Smart Ammo is now built as a weapon option; see Systems.)

## Systems (2026-11, Track K)

| Rule | Engine Behavior | Status |
|---|---|---|
| Cover HP | Per 2 × 2 m/yd square, by material: Thick Steel 50, Thick Stone 40, Thick Bulletproof Glass 30, Thin Steel 25, Thick Concrete 25, Thin Stone 20, Thick Wood 20, Thin Bulletproof Glass 15, Thick Plaster/Foam/Plastic 15, Thin Concrete 10, Thin Wood 5. Excess damage is lost. | Secondary |
| Attacking cover | Ranged: REF + skill + 1d10 vs the range DV; damage dice go to the cover's HP. Melee automatically hits an adjacent cover square. Destroyed cover becomes open ground. Unmarked cover squares are Thick Wood. | Interpretation |
| Ammunition | Armor-Piercing ablates 2. Rubber: no Critical Injuries, no ablation, can't drop a target below 1 HP. Incendiary: On Fire when damage gets through. Expansive, Poison, Sleep and grenade-only types (EMP, Smoke, Teargas, Flashbang, Biotoxin) are GM prompts. Changing ammo is a reload. | Secondary |
| Smart ammo (Core) | Needs a **Targeting Scope** (not a Smartgun Link). A single shot that misses by 4 or less gets a second attack at 10 + 1d10 against the same DV; if they dodged, they roll a fresh dodge. The second attack is flat (no other modifiers); the GM may add Luck. | Secondary (flat second attack, fresh dodge: Interpretation) |
| Smartgun Link | Weapon attachment: +1 to ranged attacks with that weapon, only when wired in (Neural Link plus Interface Plugs or a Subdermal Grip). | Secondary |
| Targeting Scope | Cybereye option: lets Smart ammo track; +1 to ranged Aimed Shots. | Secondary (Aimed Shot bonus from memory and one critic; confirm) |
| On Fire | Incendiary: 2 HP at the start of each of the target's Turns, straight to HP (armor doesn't stop fire), until an Action puts it out. | User Ruling (fire ignores armor); burn amount Interpretation |
| Improved Smart (2070s) | Behind the Edgerunners 2070s toggle; only in a **Smart Weapon** (built smart, or a Smart Rebuild of a non-Power, non-Tech gun: 1000eb, 2 of 3 attachment slots). A ranged attack that misses by 5 or less gets an immediate second attempt at 14 + 1d10 plus the first shot's penalties (Luck allowed). Smart Weapons get +1 to hit and ignore obscurement penalties (the engine has none; the GM just doesn't add them). Autofire interaction and ammo price unknown: Autofire raises a GM ruling. | Secondary (two independent reviews); Smart Weapon +1 stacking with a Smartgun Link: Interpretation |
| Launchers | Grenade and rocket launchers can't fire directly at a person or take Aimed Shots; they're area attacks. | Secondary |
| Arm injuries | Broken Arm, Dismembered Arm and Dismembered Hand each cost a hand; two-handed weapons need both. A Quick Fix restores use. | Interpretation (each injury is a different arm) |
| Hands per weapon | One-handed: Medium, Heavy and Very Heavy Pistol, SMG, Heavy SMG, Light and Medium Melee, thrown grenades. Two-handed: Shotgun, Assault Rifle, Sniper Rifle, Bows and Crossbows, Grenade and Rocket Launchers, Heavy and Very Heavy Melee. | User Ruling (Secondary until checked against the book) |
| Thrown grenades | A Thrown Grenade weapon (count = magazine) is always an area attack: DEX + Athletics vs the Grenade Launcher row, 6d6 unless overridden, one per throw. | Interpretation (range row, default dice) |
| Humanity | Starts at EMP × 10 (the base). Each installed item with Humanity Loss lowers **maximum** Humanity by 2 (borgware 4); only removing it restores that. Cyberware taken at character creation uses its fixed Humanity Loss; later installs are rolled (GM option: fixed or none). "1d6/2" halves rounding up (its fixed value is 2). EMP = floor(Humanity ÷ 10). At 0 or below: cyberpsychosis, the character goes to the GM. Removing cyberware restores half its loss, rounded down, never above the maximum. | Secondary (max Humanity, fixed at creation, EMP rounding); half-restore on removal and 1d6/2 rounding: Interpretation |
| Therapy | Standard: DV 15, 500eb, needs Humanity 40+. Extreme: DV 17, 1000eb, below 40. A week each, retry weekly; success restores 2d6, never above the maximum. | Secondary (medium confidence) |
| Solo Combat Awareness | Points ≤ rank among: Damage Deflection (2/4/6/8/10 → reduce the first damage each Round by 1–5), Fumble Recovery (4), Initiative Reaction (1 per +1), Precision Attack (3/6/9 → +1/+2/+3), Spot Weakness (1 per +1 damage before armor, first hit each Round), Threat Detection (1 per +1 Perception). Re-allocating mid-fight costs an Action. | Secondary |
| Damage Deflection timing | Reduces HP damage after armor; armor stopping everything doesn't use it up. Single-target attacks only. | User Ruling (after armor); single-target only: Interpretation |
| Medtech Medicine | One point per rank. Surgery: 2 Surgery skill per point (max 10). Pharmaceuticals and Cryosystem: 1 Medical Tech each (max 5 points each). | Secondary |
| Netrunner Interface | Role rank = Interface rank. The NET engine reads the Role; a rig's own Interface is the fallback for characters without the Netrunner Role. | Secondary |
| Natural healing | Home: BODY HP per day. Hospital bed or Enhanced Antibodies: BODY × 2 (the best applies, no stacking). Street: none. Mortally Wounded must be Stabilized first. | Secondary (stacking is Interpretation) |
| Critical Injury treatment | Quick Fix and Treatment use the injury table's skills and DVs (TECH + skill + 1d10, beat the DV). A Quick Fix that the table marks permanent removes the injury. | Easy Mode (body table) |

## Grapples, Martial Arts, Facedowns and Role Abilities (Round 3 X)

Sources: a community player handbook (melee, Martial Arts, combat and Role pages) and a community Reputation summary; never the Core book. Descriptions in the app are our own summaries.

| Rule | Engine Behavior | Status |
|---|---|---|
| Grab | Action, adjacent. DEX + Brawling + 1d10 vs the target's DEX + Brawling + 1d10; ties to the defender. Win: start a Grapple, or take one held item (the GM names it if players can't see the target's gear). An Unconscious target is grabbed automatically. | Secondary (auto-grab: Interpretation) |
| While grappling | Holder and held: −2 to all Actions (attacks and checks); no two-handed weapons; the held can't take the Move Action. The holder lets go for free. | Secondary |
| Hold breaks | When either token ends more than one square apart (holder moved off, GM moved a token), or the holder is down. | Interpretation |
| Escape | Action by the held character or an adjacent ally: same opposed check vs the holder. | Secondary |
| Choke | Action by the holder: BODY damage straight to HP, never below 1 (the target falls Unconscious instead); three Choke Actions on consecutive Rounds knock the target out. | Secondary |
| Throw | Action by the holder: BODY damage straight to HP; the hold ends; the target is Prone. | Secondary |
| Damage "straight to HP" | Skips armor (no ablation) but still counts for Wound State, the Mortally Wounded extra crit and Damage Deflection. | Interpretation |
| Special Move check | DEX + Form + 1d10 vs DV 15 unless stated; needs Form 1+. Triggered moves are free once per Turn; Action moves use the Action; strike moves replace both attacks. Triggers are checked from this Round's attack history; the GM can force a move. | Secondary |
| Core Forms | Aikido (Disarming Combination, Iron Grip), Judo (Armor Breaking Combination, Counter Throw), Karate (Bone Breaking Strike, Armor Breaking Blow), Taekwondo (Pressure Point Strike, Flying Kick). | Secondary ⚠ confirm |
| Strike injuries | Bone Breaking Strike adds Broken Ribs (aimed at the head, −8: Cracked Skull); Pressure Point Strike adds Spinal Injury (head: Brain Injury); each with the usual +5 bonus damage. | Secondary / bonus damage: Interpretation |
| Armor Breaking Blow | While held, after two Martial Arts hits on the holder this Turn: break free and the holder gets a Broken Arm. | Secondary ⚠ one source |
| Recovery | All Forms: when taking Get Up, beat DV 13 (DEX + Form) and it costs no Action; on a miss the Action is spent (no Action left: stay Prone). | Secondary (miss handling: Interpretation) |
| Expanded Forms | Moves from later books are GM prompts: the app rolls DEX + Form vs the DV and states the effect for the GM. | Secondary |
| Facedown sight | The initiator must see the target: their own sight, or for the party and allies, anything the party sees (lighting included). Off the map it's the GM's call; the GM isn't refused. | Interpretation |
| Facedown | COOL + Reputation + 1d10 each; a tie means nothing happens; the loser backs down or fights on at −2 to all Actions against the winner. No Action cost; it lasts until the GM or the winner ends it. | Secondary (duration, cost: Interpretation) |
| Reputation | GM sets 0–10 per character. | Secondary |
| Charismatic Impact | Rank + 1d10 must beat DV 8 (one person), 10 (up to 6) or 12 (huge crowd, Rank 3+). Favors scale with Rank; a failure blocks those fans for a week. | Secondary |
| Backup | Action. 1d10 at or under Rank → help in 1d6 Rounds; a 6 upgrades it one tier; Rank 10 sends two groups. | Secondary |
| Operator | Haggling is COOL + Trading + Rank + 1d10 vs the seller's roll; perks listed by Rank. | Secondary |
| Credibility | Publish: Rank + 1d10 + evidence (max +3) vs a GM DV; believability 1d10 at or under 2/2/3/3/4/4/5/5/6/7 by Rank. Rumors: Rank + 1d10 vs a GM DV. | Secondary |
| Teamwork | Members at Ranks 3, 5 and 9; new members at Loyalty 1d6+1 (max 10). Risky orders: secret 1d6, at or above Loyalty they may refuse, botch or betray. | Secondary |
| Moto | Rank added to driving, piloting and vehicle-tech skills; Family vehicles and upgrades tracked by name. | Secondary |
| Maker | 2 points per Rank, each specialty ≤ Rank. Upgrade/Fabrication/Invention: TECH + Tech skill + specialty + 1d10 vs DV 9/13/17/21/24/29/29 by price; Invention at least Expensive (DV 21). Field Expertise: jury-rig for 10 minutes × Field rank, no roll. | Secondary |
| Role checks vs DV | Like every DV check in the engine, the total must beat the DV (ties fail). | Interpretation |

## Automation (Round 4)

| Rule | Engine Behavior | Status |
|---|---|---|
| Spinal Injury | The injured character's next Turn has no Action (a Move Action is still allowed). Queued when the injury lands; a Quick Fix before that Turn cancels it. | Easy Mode |
| Broken Ribs, Foreign Object | At the end of any Turn moving more than 4 m/yds on foot, the injury's 5 bonus damage hits HP again, once per such injury. Movement = the Turn's movement cost in squares × 2 m/yds (difficult terrain counts double). Re-bleed doesn't trigger the Mortally Wounded extra crit. | Easy Mode (body) · Secondary (head) · Interpretation (distance, no extra crit) |
| Damaged Ear, Lost Ear | After a Turn moving more than 4 m/yds on foot, no Move Action next Turn. The character can still Run with their Action. | Secondary · Interpretation (Run allowed) |
| Turn-start reminders | At each Turn start the GM (and the character's player) get a checklist: Death Save, Prone, lost Action or Move, On Fire, grapples, active speedware, and the situational injury effects the engine can't apply (sight, hearing, speech, hands). | Tooling |
| Speedware, passive (Kerenzikov type) | Always adds its bonus to Initiative. | Secondary |
| Speedware, activated (Sandevistan type) | Turned on for one minute (20 Rounds); adds its bonus to Initiative rolls made while on; recharges after rest (the hour-long cooldown). Turning it on uses the Action during an encounter and is free outside one. Initiative isn't rerolled mid-fight; the GM can reroll the character in. | Secondary (bonus, duration, cooldown) · Interpretation (Action cost, no mid-fight reroll) |
| One piece of speedware | A second piece can't be installed; if a sheet has two, only the first counts. | Secondary |
| Black ICE Turns | Engaged Black ICE acts at the top of every Round, one attack each (ATK + 1d10 vs Interface + 1d10, ties to the runner). The GM gets a prompt at each new Round and runs it in one click. ICE that chased the runner attacks from the runner's floor (see Netrunning, Engagement and chasing). | Secondary |
| Demon Turns | A Demon spends its NET Actions on Control Nodes (GM call), then Zaps: Demon Interface + 1d10 vs the runner's Interface + 1d10, 1d6 to the runner on a hit. | Secondary · Interpretation (Zap uses Interface vs Interface) |
| Attack availability | One rule for the client preview and the authority: arm injuries and hands, grapples (−2, no two-handed weapons, an Iron Grip stops ranged attacks), and a lost Facedown (−2 against the winner). | Tooling |

## Light, Vision and Drawings

RED Core has no light-level rules or darkness modifier that we could confirm. Community transcriptions of the Low Light/IR/UV cybereye say it reduces penalties from darkness and obscurement (fog, smoke) to 0 and can't see through cover, but name no penalty values. So everything below is our ruling, and the penalty is a GM toggle.

| Rule | Implementation | Status |
|---|---|---|
| Ambient light | Each map is Bright (default: no lighting effects), Dim or Dark. | Interpretation |
| Light sources | Position (a fixed square or carried by a token), a bright radius and a further dim radius in squares (Chebyshev, like range), on or off. Walls and cover block light (same ray as line of sight). The brightest light on a square wins. | Interpretation |
| Seeing in the dark | A token sees a square it has line of sight to unless the square is dark; adjacent squares are always visible. Dim squares are visible. | Interpretation |
| Low Light and IR cyberoptics | A `vision` cyberware effect (Low Light or IR): dark squares count as dim, so the character sees everything in line of sight. Neither sees through cover. UV isn't modeled separately. | Secondary (no penalties in darkness) · Interpretation (dark counts as dim) |
| Darkness penalty | **House rule, off by default** (GM toggle in the Lights panel): ranged attacks into a dim square −2, into a dark square the attacker can't see −4. Low Light and IR remove both. The attack preview shows the same modifier. | House Rule |
| Party vision with lights | The union of every conscious friendly token's view. A light carried by a token the party can't see lights nothing for the party, so its glow never gives the carrier away. | Interpretation |
| Players' copy | Players receive only lights on squares the party sees (never one carried by a hidden token), without GM labels, plus the party's view and light levels computed by the relay. | Interpretation (redaction) |
| Incoming area attack | During "Blast Incoming" and "Explosive Missed", everyone sees the landing (or aim) square and the 5 × 5 blast area; a shotgun cone shows only when the shooter's token is visible, otherwise just the aim square. | Interpretation (display) |
| Drawings | GM drawings (freehand, line, rectangle, circle, text) are GM-only or shared and last until removed. With the GM's permission, players draw shared marks that fade after 30 seconds to 5 minutes (10 at a time each). Drawings never affect rules. | House Rule (table aid) |

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
15. **Darkness**: dark squares hide tokens from normal eyes beyond 1 square; Low Light and IR see them; the −2/−4 penalty is off unless you turn it on.

## Shields, Weapon Quality, Drugs and Vehicles (2026-11)

Sources: the community Player Handbook (weapons, Drugs and Addiction, Vehicle Combat pages) and a community Armor and Cover summary; never the Core book. Every example shield, drug and vehicle is original (own names and numbers); the GM enters book items as custom ones.

| Rule | Engine Behavior | Status |
|---|---|---|
| Weapon quality | Poor −1, Standard 0, Excellent +1 to attack rolls (ranged, melee, cover and vehicle attacks); never damage. Bows and crossbows can't be Excellent. | Secondary |
| Shield basics | Takes one hand (no two-handed weapons while held). Equipping or dropping it is an Action. At 0 HP it's destroyed and stays in hand until dropped. | Secondary |
| Raised shield | Blocks ranged and melee hits: the holder can't dodge ranged attacks, a shot can still miss against the range DV, and the whole hit goes into the shield's HP (damage past 0 is lost). | Secondary |
| Shield details | Explosives and other area attacks aren't blocked. Against melee the holder still rolls the usual defense (no DV is given for an undodged melee attack). Raising or lowering is free. | Interpretation |
| Human shield | The holder of a Grapple (not already holding a shield) spends an Action to raise the held character. Blocks ranged attacks except head Aimed Shots, never melee; the held can't dodge ranged attacks and takes the hit as if hit directly. Released when the Grapple ends. Dead, they become a shield with HP equal to their BODY. | Secondary |
| Drug dose | An Action (airhypo), on yourself or a willing character next to you. The primary effect starts at once; another dose restarts the duration instead of stacking. STAT changes apply through the engine; other effects are GM notes. | Secondary |
| Wearing off and addiction | When the GM ends a dose: WILL + Resist Torture/Drugs + 1d10 vs the drug's DV. Failing adds an addiction: its secondary effect applies until the next dose of that drug or a cure (GM, after therapy). Addictions count separately. | Secondary (GM-ended doses: Interpretation) |
| Hostile dosing | A melee attack with an airhypo: the GM rules it. | Interpretation |
| Vehicle basics | A vehicle actor's HP is its SDP; it has seats and a combat MOVE. Vehicles never take Turns (they act on the driver's). At 0 SDP it's wrecked and can't be driven. | Secondary (one source) |
| Attacking vehicles | Attack Vehicle: no dodge, normal range DVs; damage comes off SDP. An Aimed Shot at a weak spot is −8 and doubles the damage that gets through. Ordinary attacks on vehicles are refused with a pointer to Attack Vehicle. | Secondary (one source) |
| Vehicle armor | No SP of its own; GM-added plating SP comes off each hit before the weak-spot doubling. | Interpretation |
| Driving and boarding | Boarding, taking the wheel and getting out each use the Move Action. The driver's Move Action moves the vehicle up to its MOVE in squares. A driver with REF + Drive Land Vehicle of 9 or less gets a GM prompt for a control check. Melee on an adjacent vehicle hits automatically. | Secondary (control check) · Interpretation (Move Action costs, auto-hit melee) |
| Ramming and occupants | Ramming raises a GM prompt (both take damage, whiplash, a pedestrian may dodge). Shots at someone inside a vehicle are the GM's call. | Secondary (GM prompt) |

## Not Built Yet

- Vehicle chases, collision damage numbers and whiplash effects (GM prompts). Moto tracks Family vehicles by name only.
- Shooting a particular vehicle occupant from the attack panel (the GM rules it).

Built since earlier versions of this list: Broken Ribs and Foreign Object re-bleed, Spinal Injury's lost Action, and the ear injuries' lost Move Action (see Automation); Martial Arts Special Moves; Demon Turns; light sources, darkness and night vision (see Light, Vision and Drawings).

## Rules Packs and Book Values (Round 3)

The repository ships only original example cyberware, Programs and gear. The book's cyberware catalog (names, Humanity Loss dice and fixed values, install location, cost) is a **rules pack** the GM imports on their own device (Characters → Cyberware and Humanity → Import Rules Pack). Packs are validated, stored in the GM's browser only, and never written to the session log or this repository. Format: `{ "format": "nsc-rules-pack", "version": 1, "name": "...", "cyberware": [{ "name", "slot", "hlDice": "2d6", "hlFixed": 7, "install": "clinic", "costEb": 500, "borgware"?, "effects"?: [...], "notes"? }], "programs"?: [...] }`.
