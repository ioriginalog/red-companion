/**
 * A modest gear list for the character builder: generic, everyday items in
 * this tool's own words (no book stats or prices). GMs add anything else by name.
 */
export interface GearPreset { name: string; summary: string }

export const GEAR_PRESETS: GearPreset[] = [
  { name: 'Agent (Smartphone)', summary: 'Phone, wallet and personal assistant.' },
  { name: 'Flashlight', summary: 'Hand light.' },
  { name: 'Binoculars', summary: 'See far, see first.' },
  { name: 'Medkit', summary: 'Bandages and basics for First Aid.' },
  { name: 'Airhypo', summary: 'Delivers a dose without a needle.' },
  { name: 'Rope (30 m)', summary: 'Climbing and tying.' },
  { name: 'Lockpick Set', summary: 'For Pick Lock checks.' },
  { name: 'Tech Toolkit', summary: 'For Basic Tech repairs.' },
  { name: 'Radio Scanner', summary: 'Listens in on open channels.' },
  { name: 'Handcuffs', summary: 'Restrain someone.' },
  { name: 'Duct Tape', summary: 'Fixes everything, briefly.' },
  { name: 'Spare Magazine', summary: 'A reload’s worth of rounds.' },
  { name: 'Smoke Grenade', summary: 'Covers a retreat (GM resolves).' },
  { name: 'Kibble (Day Ration)', summary: 'Tastes like nothing. Keeps you going.' },
];
