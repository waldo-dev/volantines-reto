import { clamp, type V3 } from './vec';
import type { KiteInput, KiteState, Loadout } from './kite';

/** Estado de la "cabeza" de un bot que encumbra y busca cruzar hilos. */
export interface BotBrain {
  mode: 'encumbrar' | 'volar' | 'atacar';
  targetLen: number; // m de hilo con que le gusta volar
  aggression: number; // 0..1: qué tanto busca pelea
  skill: number; // 0..1: qué tan bien maneja los tirones
  pulse: number; // s restantes del tirón actual
  pause: number; // s hasta el próximo tirón
  modeTimer: number;
  target: string | null;
  inContact: boolean;
  /** Estaba cruzado el paso anterior (para reaccionar justo al empezar un cruce). */
  wasContact: boolean;
  /** s que le quedan dando cuerda rápido (largada). */
  rapidLeft: number;
  /** Ya decidió si pega el tirón al acercarse a este cruce (uno por intento). */
  triedTiron: boolean;
}

export function createBrain(rand: () => number, skill = 0.5): BotBrain {
  return {
    mode: 'encumbrar',
    targetLen: 35 + rand() * 25,
    aggression: 0.35 + rand() * 0.5,
    skill,
    pulse: 0,
    pause: 0,
    modeTimer: 0,
    target: null,
    inContact: false,
    wasContact: false,
    rapidLeft: 0,
    triedTiron: false,
  };
}

export interface BotView {
  id: string;
  anchor: V3;
  kite: KiteState;
  lo: Loadout;
}

/**
 * Decide la entrada del bot para este paso.
 * - Encumbrar: suelta hilo y da tirones cuando la punta mira hacia arriba.
 * - Volar: mantiene la punta derecha y la altura.
 * - Atacar: se corre hacia el hilo del rival y, cruzado, tira para que su hilo "corra" por el cruce.
 */
export function botThink(b: BotBrain, self: BotView, rivals: BotView[], windDir: V3, dt: number, rand: () => number): KiteInput {
  const k = self.kite;
  const input: KiteInput = { tirar: false, soltar: false, dirX: 0 };
  if (k.broken || k.stowed) return input;

  b.modeTimer -= dt;
  b.pause -= dt;
  const pointsUp = Math.abs(k.heading) < 0.35 + 0.25 * (1 - b.skill);
  // Corrige la punta: dirigir hacia el lado contrario de donde se está volteando
  let steer = clamp(-k.heading * (1.2 + b.skill), -1, 1);

  if (b.mode === 'encumbrar') {
    input.soltar = true;
    if (k.lineLength >= b.targetLen) {
      b.mode = 'volar';
      b.modeTimer = 3 + rand() * 4;
    }
  } else if (b.mode === 'volar') {
    if (k.lineLength < b.targetLen - 8) input.soltar = true;
    if (b.modeTimer <= 0) {
      b.modeTimer = 4 + rand() * 5;
      const alive = rivals.filter((r) => !r.kite.broken && !r.kite.stowed);
      if (alive.length && rand() < b.aggression) {
        b.mode = 'atacar';
        b.target = alive[Math.floor(rand() * alive.length)].id;
        b.triedTiron = false;
      }
    }
  } else {
    const rival = rivals.find((r) => r.id === b.target);
    if (!rival || rival.kite.broken || rival.kite.stowed || b.modeTimer <= 0) {
      b.mode = 'volar';
      b.target = null;
      b.modeTimer = 6 + rand() * 8;
    } else {
      // Lado del rival respecto de mi hilo, en el plano perpendicular al viento
      const sideX = -windDir.z;
      const sideZ = windDir.x;
      const mine = (k.pos.x - self.anchor.x) * sideX + (k.pos.z - self.anchor.z) * sideZ;
      const theirs = (rival.kite.pos.x - self.anchor.x) * sideX + (rival.kite.pos.z - self.anchor.z) * sideZ;
      // Para que los hilos se crucen, mi volantín tiene que pasar al otro lado del hilo rival:
      // hacia el lado donde está parado el rival
      const handGap = (rival.anchor.x - self.anchor.x) * sideX + (rival.anchor.z - self.anchor.z) * sideZ;
      const gap = theirs + Math.sign(handGap || 1) * 5 - mine;
      if (!b.inContact) steer = clamp(steer + clamp(gap / 12, -0.8, 0.8), -1, 1);
      // A punto de cruzarse: a veces un tirón seco hacia el hilo rival (si le sale a tiempo, es crítico)
      if (!b.inContact && Math.abs(gap) < 4 && !b.triedTiron) {
        b.triedTiron = true;
        if (rand() < b.skill * 0.45) {
          input.tiron = true;
          steer = Math.sign(gap) || steer;
        }
      }
      // Quedar un poco más arriba que el rival da ventaja en el cruce
      if (k.pos.y < rival.kite.pos.y + 2 && pointsUp && b.pause <= 0) {
        b.pulse = 0.25 + 0.2 * b.skill;
        b.pause = 0.6;
      }
      if (b.inContact) {
        // Cruzado: tironea para que el hilo corra, sin pasarse de tensión
        if (k.stress < 0.85 && b.pause <= 0) {
          b.pulse = 0.35 + 0.3 * b.skill;
          b.pause = 0.25;
        } else if (k.stress > 0.95) {
          input.soltar = true;
        }
      }
    }
  }

  // Justo al cruzarse, los hábiles pegan un tirón o una largada para el golpe crítico
  if (b.inContact && !b.wasContact && rand() < b.skill * 0.4) {
    if (k.stress > 0.7 && rand() < 0.5) b.rapidLeft = 0.4;
    else input.tiron = true;
  }
  if (b.wasContact && !b.inContact) b.triedTiron = false;
  b.wasContact = b.inContact;

  // Tirones cortos cuando la punta mira hacia arriba (así se gana altura)
  if (b.mode !== 'atacar' && pointsUp && k.pos.y - self.anchor.y < b.targetLen * 0.55 && b.pause <= 0 && rand() < dt * 2) {
    b.pulse = 0.3;
    b.pause = 1.2;
  }
  if (b.pulse > 0) {
    b.pulse -= dt;
    if (pointsUp || b.inContact) {
      input.tirar = true;
      input.soltar = false;
    }
  }
  if (b.rapidLeft > 0) {
    b.rapidLeft -= dt;
    input.tirar = false;
    input.soltar = true;
    input.rapido = true;
  }
  // Nunca pasarse de tensión por mucho rato
  if (k.wear > 0.4) {
    input.tirar = false;
    input.soltar = true;
  }
  input.dirX = steer;
  return input;
}
