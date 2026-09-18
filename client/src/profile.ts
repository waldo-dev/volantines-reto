import { BRIDLES, KITES, LINES, REELS, type Gear, type Loadout } from '@volantines/shared';

export { CHARACTERS, GLASSES, HATS, type Look } from '@volantines/shared';
export type HatId = import('@volantines/shared').Look['hat'];

/** Equipo con el que vuela el jugador, a partir de los ids elegidos. */
export function loadoutFrom(gear: Gear): Loadout {
  const pick = <T extends { id: string }>(list: T[], id: string) => list.find((i) => i.id === id) ?? list[0];
  return {
    kite: pick(KITES, gear.kite),
    line: pick(LINES, gear.line),
    reel: pick(REELS, gear.reel),
    bridle: pick(BRIDLES, gear.bridle),
  };
}
