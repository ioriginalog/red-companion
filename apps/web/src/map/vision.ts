/**
 * The viewer's vision and light levels, from the same functions the relay
 * uses for redaction (packages/session/src/vision.ts):
 *  - a player's projection carries `seen` (the relay's own result), so the
 *    client never needs the lights it wasn't sent;
 *  - the GM computes party vision from the full map.
 * Display only; the relay has already withheld what players can't see.
 */
import {
  decodeSeen, lightingActive, lightLevels, partyView, senseOf,
  type LightLevel, type ProjectedActor, type Seer, type TacticalMap, type ViewState,
} from '@cprc/session';

const friendly = (a?: ProjectedActor) => !!a && (a.public.allegiance === 'party' || a.public.allegiance === 'ally');
const sees = (a: ProjectedActor) => !a.public.conditions.dead && !a.public.conditions.unconscious;

export interface ClientVision {
  vision: Set<string>;
  /** Light level per square that differs from ambient (null: no lighting in play). Players: only squares they see. */
  levels: Map<string, LightLevel> | null;
  /** The map whose lights produced `levels` (the GM's copy may drop hidden carriers' lights). */
  lightMap: TacticalMap;
}

/** Seers and friendly ids from the viewer's actors (the GM has every combatant, so senses are exact). */
export function seersOf(view: ViewState): { seers: Seer[]; friendlyIds: Set<string>; sig: string } {
  const map = view.map!;
  const seers: Seer[] = [];
  const friendlyIds = new Set<string>();
  const sig: string[] = [];
  for (const [id, at] of Object.entries(map.tokens)) {
    const a = view.actors[id];
    if (!friendly(a)) continue;
    friendlyIds.add(id);
    if (!sees(a!)) continue;
    const sense = senseOf(a!.combatant);
    seers.push({ at, sense });
    sig.push(`${id}:${sense}`);
  }
  return { seers, friendlyIds, sig: sig.sort().join(',') };
}

export function clientVision(view: ViewState): ClientVision {
  const map = view.map;
  if (!map) return { vision: new Set(), levels: null, lightMap: { width: 0, height: 0, cells: '' } as unknown as TacticalMap };
  const relay = decodeSeen(map);
  if (relay) return { vision: relay.vision, levels: relay.levels, lightMap: map };
  const { seers, friendlyIds } = seersOf(view);
  const pv = partyView(map, seers, friendlyIds);
  return { vision: pv.vision, levels: lightingActive(map) ? lightLevels(pv.lightMap) : null, lightMap: pv.lightMap };
}
