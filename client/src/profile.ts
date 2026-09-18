import { gearLoadout, type Gear, type Loadout } from '@volantines/shared';

export { CHARACTERS, GLASSES, HATS, type Look } from '@volantines/shared';
export type HatId = import('@volantines/shared').Look['hat'];

/** Equipo con el que vuela el jugador, a partir de los ids elegidos. */
export function loadoutFrom(gear: Gear): Loadout {
  return gearLoadout(gear);
}
