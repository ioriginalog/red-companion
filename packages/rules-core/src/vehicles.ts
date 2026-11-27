/**
 * Basic vehicles (Secondary, one community source: the Player Handbook's
 * Vehicle Combat page).
 *
 * - A vehicle has SDP instead of HP (stored as the vehicle actor's HP), a
 *   seat count and a combat MOVE. At 0 SDP it's destroyed: it stops and
 *   can't be driven until repaired.
 * - Vehicles can't dodge. Attacks use the normal range DVs and damage comes
 *   off SDP. An Aimed Shot at a weak spot (engine, tires) is −8 and doubles
 *   the damage that gets through.
 * - Vehicles have no SP of their own; GM-added plating subtracts its SP from
 *   each hit (how plating works isn't spelled out: Interpretation).
 * - Ramming, whiplash, losing control and shooting a particular occupant are
 *   GM calls; the app raises a prompt.
 *
 * Interpretations: the vehicle moves its MOVE in squares on its driver's Move
 * Action; boarding and getting out each take the Move Action; melee attacks
 * on an adjacent vehicle hit automatically (like cover). The example vehicles
 * are ORIGINAL (own names and numbers).
 */
import type { VehicleData } from './types.js';

export const VEHICLE_AIM_PENALTY = -8;

export interface VehicleTemplate { id: string; name: string; sdp: number; seats: number; move: number; topSpeed: string; summary: string }

/** Original examples, not book vehicles. */
export const VEHICLE_TEMPLATES: VehicleTemplate[] = [
  { id: 'scooter', name: 'Delivery Scooter', sdp: 18, seats: 1, move: 12, topSpeed: '60 mph', summary: 'Original. Noodle-shop scooter with a cracked fairing.' },
  { id: 'hatch', name: 'Rust-Belt Hatchback', sdp: 45, seats: 4, move: 18, topSpeed: '110 mph', summary: 'Original. Four doors, three of them open.' },
  { id: 'van', name: 'Panel Van', sdp: 60, seats: 3, move: 16, topSpeed: '95 mph', summary: 'Original. Room in the back for gear or trouble.' },
];

/** Damage to SDP from one hit: plating SP comes off first, then an aimed weak-spot hit doubles what gets through. */
export function vehicleDamage(rolled: number, sp: number | undefined, aimed: boolean): number {
  const through = Math.max(0, rolled - Math.max(0, sp ?? 0));
  return aimed ? through * 2 : through;
}

export const seatsLeft = (v: VehicleData) => Math.max(0, v.seats - v.passengers.length);

/** Null if valid, else the reason. */
export function vehicleProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'Vehicle data must be an object.';
  const o = v as Record<string, unknown>;
  if (!Number.isInteger(o.seats) || (o.seats as number) < 1 || (o.seats as number) > 20) return 'Seats must be a whole number from 1 to 20.';
  if (!Number.isInteger(o.move) || (o.move as number) < 0 || (o.move as number) > 60) return 'Vehicle MOVE must be a whole number from 0 to 60.';
  if (o.topSpeed !== undefined && (typeof o.topSpeed !== 'string' || o.topSpeed.length > 30)) return 'Top speed must be text up to 30 characters.';
  if (o.sp !== undefined && (!Number.isInteger(o.sp) || (o.sp as number) < 0 || (o.sp as number) > 50)) return 'Plating SP must be a whole number from 0 to 50.';
  if (!Array.isArray(o.passengers) || o.passengers.length > (o.seats as number)) return 'Passengers must be a list no longer than the seats.';
  for (const p of o.passengers) if (typeof p !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(p)) return 'Passenger ids must be valid ids.';
  if (new Set(o.passengers).size !== o.passengers.length) return 'A passenger can only sit once.';
  if (o.driverId !== undefined && o.driverId !== null && (typeof o.driverId !== 'string' || !o.passengers.includes(o.driverId))) return 'The driver must be aboard.';
  const extra = Object.keys(o).filter((k) => !['seats', 'move', 'topSpeed', 'sp', 'passengers', 'driverId'].includes(k));
  return extra.length ? 'Vehicle data has an unknown field.' : null;
}
