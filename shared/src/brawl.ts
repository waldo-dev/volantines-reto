import type { V3 } from './vec';

/**
 * Charchazos: a pie (sin volantín en el aire) puedes empujar a alguien que esté al lado. El que lo recibe queda
 * botado un rato sin poder moverse ni manejar su volantín, y si lleva volantines en la mochila se le cae uno.
 * Si le pegas a quien te cortó hace poco, es VENGANZA.
 */
export const BRAWL = {
  /** m: hasta dónde llega el brazo. */
  range: 1.9,
  /** rad: qué tan de frente tiene que estar (mitad del ángulo). Muy pegado (< `close`) vale desde cualquier lado. */
  cone: 1.1,
  close: 1,
  /** s entre un charchazo y el siguiente del mismo jugador. */
  cooldown: 2.5,
  /** s botado sin poder moverse ni manejar el volantín. */
  stun: 1.2,
  /** Empujón: velocidad (m/s) y cuánto dura (s). */
  knockSpeed: 7,
  knockTime: 0.3,
  /** s de protección después de recibir uno (nadie te puede dejar pegado en el suelo). */
  guard: 2.5,
  /** s durante los que pegarle a quien te cortó cuenta como venganza. */
  revengeWindow: 45,
  /** Probabilidad de que un bot cortado por una persona vaya a pegarle, y cuánto la persigue (s). */
  botRevengeChance: 0.5,
  botRevengeTime: 12,
};

export interface BrawlBody {
  id: string;
  pos: V3;
  /** Hacia dónde mira (rad): la dirección es (sin f, cos f). */
  facing: number;
}

/** El más cercano al que alcanzas a pegarle: al frente y a menos de `range` (o muy pegado, desde cualquier lado). */
export function brawlTarget<T extends { id: string; pos: V3 }>(attacker: BrawlBody, others: readonly T[], canBeHit: (o: T) => boolean): T | null {
  const fx = Math.sin(attacker.facing);
  const fz = Math.cos(attacker.facing);
  let best: T | null = null;
  let bestD = Infinity;
  for (const o of others) {
    if (o.id === attacker.id || !canBeHit(o)) continue;
    const dx = o.pos.x - attacker.pos.x;
    const dz = o.pos.z - attacker.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > BRAWL.range || d >= bestD || Math.abs(o.pos.y - attacker.pos.y) > 1.5) continue;
    const ang = d < 1e-6 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
    if (ang > BRAWL.cone && d > BRAWL.close) continue;
    best = o;
    bestD = d;
  }
  return best;
}

/** Dirección del empujón (del que pega al que recibe), en el plano. */
export function knockDir(from: V3, to: V3): { x: number; z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  return d < 1e-6 ? { x: 0, z: 1 } : { x: dx / d, z: dz / d };
}

/** Quién cortó a quién y cuándo, para saber si un charchazo es venganza (cada corte se venga una sola vez). */
export class RevengeBook {
  private last = new Map<string, { by: string; at: number }>();

  cut(victim: string, cutter: string, time: number) {
    this.last.set(victim, { by: cutter, at: time });
  }

  /** ¿`attacker` le está pegando a quien lo cortó hace poco? Si es así, lo consume. */
  take(attacker: string, victim: string, time: number): boolean {
    const c = this.last.get(attacker);
    if (!c || c.by !== victim || time - c.at > BRAWL.revengeWindow) return false;
    this.last.delete(attacker);
    return true;
  }

  forget(id: string) {
    this.last.delete(id);
    for (const [k, v] of this.last) if (v.by === id) this.last.delete(k);
  }
}
