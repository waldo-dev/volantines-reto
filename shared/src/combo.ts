import type { LineDef } from './items';

/** Combos de cortes seguidos y la racha "¡Encachado!" (ver plan, fase 1). */
export const COMBO = {
  window: 20, // s máximos entre un corte y el siguiente para seguir el combo
  streakAt: 3, // cortes seguidos que activan la racha
  streakTime: 25, // s que dura la racha; cada corte nuevo la renueva
};

const NAMES = ['', '', 'DOBLE', 'TRIPLE', 'CUÁDRUPLE', 'QUÍNTUPLE', 'SÉXTUPLE', 'SÉPTUPLE', 'ÓCTUPLE', 'NÓNUPLE', 'DÉCUPLE'];

/** "DOBLE", "TRIPLE"… (vacío para un corte suelto; más de 10 es "COMBO ×N"). */
export const comboName = (n: number) => (n < NAMES.length ? NAMES[n] : `COMBO ×${n}`);

export interface ComboState {
  count: number;
  last: number; // hora del último corte
  streakUntil: number; // hora en que termina la racha
}

export const newCombo = (): ComboState => ({ count: 0, last: -Infinity, streakUntil: -Infinity });

export const streakActive = (c: ComboState, now: number) => now < c.streakUntil;

/** Suma un corte al combo. Devuelve el largo del combo y si la racha empezó con este corte. */
export function registerCut(c: ComboState, now: number): { combo: number; streakStarted: boolean } {
  c.count = now - c.last <= COMBO.window ? c.count + 1 : 1;
  c.last = now;
  const wasActive = streakActive(c, now);
  if (c.count >= COMBO.streakAt || wasActive) c.streakUntil = now + COMBO.streakTime;
  return { combo: c.count, streakStarted: !wasActive && c.count >= COMBO.streakAt };
}

/** Al quedar cortado se pierden el combo y la racha. */
export function resetCombo(c: ComboState) {
  c.count = 0;
  c.last = -Infinity;
  c.streakUntil = -Infinity;
}

/** Cortar con un hilo de menor nivel que el del rival: premio "contra la corriente". */
export const isUpset = (cutter: LineDef, victim: LineDef) => cutter.nivel < victim.nivel;
