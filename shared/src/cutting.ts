import { clamp, type V3 } from './vec';
import { PHYS, TAIL, type KiteState, type Loadout, type ManeuverKind } from './kite';

/** Constantes del corte (ver spec: "Sistema de corte"). */
export const CUT = {
  K: 40, // con hilos iguales y uno corriendo por el cruce, el corte toma unos 2 a 4 s
  contactDist: 0.8, // distancia "efectiva" entre hilos para que se crucen
  holdDist: 3.5, // una vez cruzados quedan enganchados mientras no se separen más que esto
  /**
   * Si los hilos se cruzan vistos desde arriba, el de arriba se monta sobre el de abajo:
   * la separación vertical cuenta solo en esta fracción (5 m de diferencia ≈ 0,75 m efectivos).
   */
  verticalFactor: 0.15,
  critWindow: 0.5, // s desde que se cruzan los hilos en que una maniobra cuenta como golpe crítico
  critLead: 0.35, // la maniobra también vale si empezó hasta esto antes del cruce
  critDamage: 30, // integridad que quita un crítico con hilos iguales
  weakZone: 0.8, // desde esta fracción del hilo (de la mano al volantín) empieza la zona débil
  weakFactor: 1.3, // daño extra en la zona débil
  boostFilo: 1.25, // racha "encachado": filo extra
  boostRecover: 2, // racha "encachado": recuperación extra
  tailDist: 1.2, // un hilo a menos de esto de una cola, con un tirón seco, la corta
  tailWhip: 0.35, // s desde el tirón en que el latigazo todavía corta colas
  skipNearHand: 2, // segmentos junto a la mano que no cuentan (evita cruces entre jugadores pegados)
  minLine: 15, // protección al encumbrar: con menos hilo que esto no hay cruces
  minHeight: 8, // ni con el volantín más bajo que esto (m sobre la mano)
};

/** Un hilo en juego: sus puntos (de la mano al volantín), su volantín y su equipo. */
export interface LineBody {
  id: string;
  pts: V3[];
  kite: KiteState;
  lo: Loadout;
  /** En racha ("encachado"): más filo y más recuperación. */
  boost?: boolean;
}

/** Dos hilos enganchados: cuánto llevan cruzados y quién ya hizo su golpe crítico. */
export interface Hook {
  age: number;
  crit: string[];
}

export interface Crit {
  by: string;
  victim: string;
  kind: ManeuverKind;
  damage: number;
}

export interface Contact {
  a: string;
  b: string;
  point: V3;
  /** Daño por segundo que cada hilo le hace al otro. */
  damageToA: number;
  damageToB: number;
  /** El cruce cae en la zona débil (cerca del volantín) de cada hilo. */
  weakA: boolean;
  weakB: boolean;
  crits: Crit[];
}

const tmpC1: V3 = { x: 0, y: 0, z: 0 };
const tmpC2: V3 = { x: 0, y: 0, z: 0 };

/** Distancia mínima entre los segmentos p1-q1 y p2-q2; deja los puntos más cercanos en c1 y c2. */
export function segmentDistance(p1: V3, q1: V3, p2: V3, q2: V3, c1: V3, c2: V3): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  c1.x = p1.x + d1x * s;
  c1.y = p1.y + d1y * s;
  c1.z = p1.z + d1z * s;
  c2.x = p2.x + d2x * t;
  c2.y = p2.y + d2y * t;
  c2.z = p2.z + d2z * t;
  return Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z);
}

/**
 * Si los segmentos se cruzan vistos desde arriba (plano xz), devuelve la diferencia de altura
 * en el cruce (positiva si el primero va arriba) y deja el punto en `out`; si no, null.
 */
export function planCrossing(p1: V3, q1: V3, p2: V3, q2: V3, out: V3): number | null {
  const ax = q1.x - p1.x, az = q1.z - p1.z;
  const bx = q2.x - p2.x, bz = q2.z - p2.z;
  const den = ax * bz - az * bx;
  if (Math.abs(den) < 1e-9) return null;
  const cx = p2.x - p1.x, cz = p2.z - p1.z;
  const s = (cx * bz - cz * bx) / den;
  const t = (cx * az - cz * ax) / den;
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  const y1 = p1.y + (q1.y - p1.y) * s;
  const y2 = p2.y + (q2.y - p2.y) * t;
  out.x = p1.x + ax * s;
  out.y = (y1 + y2) / 2;
  out.z = p1.z + az * s;
  return y1 - y2;
}

/** Qué tan rápido pasa el hilo por el cruce (0..1): al tirar, al soltar o con el volantín en movimiento. */
export function slideOf(k: KiteState, lo: Loadout): number {
  const reel = clamp(Math.abs(k.lineRate) / (PHYS.reelBase * lo.reel.speed), 0, 1);
  const motion = clamp(Math.hypot(k.vel.x, k.vel.y, k.vel.z) / 8, 0, 0.6);
  return clamp(reel + motion, 0, 1);
}

const filoOf = (l: LineBody) => l.lo.line.filo * (l.boost ? CUT.boostFilo : 1);

/** Daño por segundo que el hilo A le hace al hilo B cuando se cruzan (`weakB`: en la zona débil de B). */
export function cutDamage(a: LineBody, b: LineBody, aAbove: boolean, weakB = false): number {
  const alt = aAbove ? 1.2 : 0.8;
  const weak = weakB ? CUT.weakFactor : 1;
  return (CUT.K * filoOf(a) * (0.4 + a.kite.tension) * (0.2 + slideOf(a.kite, a.lo)) * alt * weak) / b.lo.line.resistencia;
}

/** Integridad que quita de una vez un golpe crítico de A sobre B. */
export function critDamage(a: LineBody, b: LineBody, weakB = false): number {
  return (CUT.critDamage * filoOf(a) * (weakB ? CUT.weakFactor : 1)) / b.lo.line.resistencia;
}

/** Recuperación por segundo de un hilo sin contacto. */
export const recoverRate = (l: LineBody) => l.lo.line.recuperacion * (l.boost ? CUT.boostRecover : 1);

/** Un hilo participa en cruces si está volando y ya pasó la protección de encumbre. */
const active = (l: LineBody) =>
  !l.kite.broken && !l.kite.stowed && l.kite.lineLength >= CUT.minLine && l.kite.pos.y - l.pts[0].y >= CUT.minHeight;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** ¿La maniobra de este volantín coincide con el inicio del cruce? */
const critTiming = (k: KiteState, hook: Hook) =>
  k.maneuver !== 0 && hook.age <= CUT.critWindow && k.maneuverAge <= hook.age + CUT.critLead;

/**
 * Busca cruces entre todos los hilos y aplica el desgaste a la integridad de cada uno.
 * Dos hilos que se tocan quedan enganchados (`hooks`) y siguen raspándose hasta separarse o cortarse,
 * como en una comisión de verdad. Un hilo que llega a 0 queda cortado (`kite.broken`).
 * Un tirón seco o una largada justo al cruzarse da un golpe crítico (una vez por enganche).
 */
export function resolveCrossings(lines: LineBody[], dt: number, hooks: Map<string, Hook> = new Map()): Contact[] {
  const contacts: Contact[] = [];
  const touched = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const A = lines[i];
    if (!active(A)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const B = lines[j];
      if (!active(B)) continue;
      let best = Infinity;
      let point: V3 | null = null;
      let aAbove = false;
      let segA = 0;
      let segB = 0;
      for (let si = CUT.skipNearHand; si < A.pts.length - 1; si++) {
        for (let sj = CUT.skipNearHand; sj < B.pts.length - 1; sj++) {
          const a0 = A.pts[si], a1 = A.pts[si + 1], b0 = B.pts[sj], b1 = B.pts[sj + 1];
          const d = segmentDistance(a0, a1, b0, b1, tmpC1, tmpC2);
          if (d < best) {
            best = d;
            aAbove = tmpC1.y >= tmpC2.y;
            point = { x: (tmpC1.x + tmpC2.x) / 2, y: (tmpC1.y + tmpC2.y) / 2, z: (tmpC1.z + tmpC2.z) / 2 };
            segA = si;
            segB = sj;
          }
          const dy = planCrossing(a0, a1, b0, b1, tmpC1);
          if (dy !== null && Math.abs(dy) * CUT.verticalFactor < best) {
            best = Math.abs(dy) * CUT.verticalFactor;
            aAbove = dy >= 0;
            point = { x: tmpC1.x, y: tmpC1.y, z: tmpC1.z };
            segA = si;
            segB = sj;
          }
        }
      }
      const key = pairKey(A.id, B.id);
      let hook = hooks.get(key);
      if (!point || best > (hook ? CUT.holdDist : CUT.contactDist)) {
        hooks.delete(key);
        continue;
      }
      if (hook) hook.age += dt;
      else hooks.set(key, (hook = { age: 0, crit: [] }));
      const weakA = (segA + 0.5) / (A.pts.length - 1) >= CUT.weakZone;
      const weakB = (segB + 0.5) / (B.pts.length - 1) >= CUT.weakZone;
      const damageToB = cutDamage(A, B, aAbove, weakB);
      const damageToA = cutDamage(B, A, !aAbove, weakA);
      A.kite.integrity -= damageToA * dt;
      B.kite.integrity -= damageToB * dt;
      const crits: Crit[] = [];
      for (const [X, Y, weakY] of [[A, B, weakB], [B, A, weakA]] as const) {
        if (hook.crit.includes(X.id) || !critTiming(X.kite, hook)) continue;
        hook.crit.push(X.id);
        const damage = critDamage(X, Y, weakY);
        Y.kite.integrity -= damage;
        crits.push({ by: X.id, victim: Y.id, kind: X.kite.maneuver, damage });
      }
      touched.add(A.id).add(B.id);
      contacts.push({ a: A.id, b: B.id, point, damageToA, damageToB, weakA, weakB, crits });
    }
  }
  // Enganches de hilos que ya no están en juego
  const alive = new Set(lines.filter(active).map((l) => l.id));
  for (const key of hooks.keys()) {
    const [a, b] = key.split('|');
    if (!alive.has(a) || !alive.has(b)) hooks.delete(key);
  }
  for (const l of lines) {
    if (!active(l)) continue;
    if (!touched.has(l.id)) l.kite.integrity = Math.min(100, l.kite.integrity + recoverRate(l) * dt);
    if (l.kite.integrity <= 0) {
      l.kite.integrity = 0;
      l.kite.broken = true;
      l.kite.tensionN = l.kite.tension = l.kite.stress = 0;
    }
  }
  return contacts;
}

export interface TailCut {
  by: string;
  victim: string;
  point: V3;
}

const tailA: V3 = { x: 0, y: 0, z: 0 };
const tailB: V3 = { x: 0, y: 0, z: 0 };

/**
 * La cola de un volantín: cuelga hacia abajo y hacia atrás (lejos de la mano).
 * Deja los extremos en `a` y `b`.
 */
export function tailSegment(l: LineBody, a: V3, b: V3) {
  const k = l.kite.pos;
  const hand = l.pts[0];
  let hx = k.x - hand.x;
  let hz = k.z - hand.z;
  const h = Math.hypot(hx, hz) || 1;
  hx /= h;
  hz /= h;
  a.x = k.x;
  a.y = k.y;
  a.z = k.z;
  b.x = k.x + hx * TAIL.length * 0.6;
  b.y = k.y - TAIL.length * 0.8;
  b.z = k.z + hz * TAIL.length * 0.6;
}

/**
 * Cortes de cola: un hilo que pasa pegado a la cola de un volantín con cola, justo después de un
 * tirón seco (el latigazo), se la corta. Marca `kite.tailCut` y devuelve quién se la cortó a quién.
 */
export function resolveTailCuts(lines: LineBody[]): TailCut[] {
  const cuts: TailCut[] = [];
  for (const V of lines) {
    if (!V.lo.kite.cola || V.kite.tailCut || !active(V)) continue;
    tailSegment(V, tailA, tailB);
    for (const X of lines) {
      if (X === V || !active(X) || X.kite.maneuver !== 1 || X.kite.maneuverAge > CUT.tailWhip) continue;
      let hit = false;
      for (let si = CUT.skipNearHand; si < X.pts.length - 1 && !hit; si++) {
        hit = segmentDistance(X.pts[si], X.pts[si + 1], tailA, tailB, tmpC1, tmpC2) < CUT.tailDist;
      }
      if (!hit) continue;
      V.kite.tailCut = true;
      cuts.push({ by: X.id, victim: V.id, point: { x: tmpC2.x, y: tmpC2.y, z: tmpC2.z } });
      break;
    }
  }
  return cuts;
}

/** Cables del tendido eléctrico (Valparaíso): enredan y gastan el hilo que los toca. */
export const CABLE = {
  dist: 0.7, // un hilo a menos de esto de un cable queda raspándose
  damage: 14, // integridad por segundo (dividida por la resistencia del hilo)
  kiteDist: 1.4, // el volantín enredado en el cable
  kiteDamage: 45,
};

export type CableSegment = { a: V3; b: V3 };

/**
 * Hilos que tocan los cables: se gastan (sin protección de encumbre: el cable no espera).
 * Devuelve los ids de los hilos que están tocando algún cable y dónde.
 */
export function resolveCables(lines: LineBody[], cables: CableSegment[], dt: number): { id: string; point: V3 }[] {
  const out: { id: string; point: V3 }[] = [];
  if (!cables.length) return out;
  for (const l of lines) {
    const k = l.kite;
    if (k.broken || k.stowed) continue;
    let hit: V3 | null = null;
    let dmg = 0;
    for (const c of cables) {
      for (let si = 1; si < l.pts.length - 1; si++) {
        if (segmentDistance(l.pts[si], l.pts[si + 1], c.a, c.b, tmpC1, tmpC2) < CABLE.dist) {
          dmg = Math.max(dmg, CABLE.damage);
          hit = { x: tmpC2.x, y: tmpC2.y, z: tmpC2.z };
          break;
        }
      }
      if (segmentDistance(k.pos, k.pos, c.a, c.b, tmpC1, tmpC2) < CABLE.kiteDist) {
        dmg = CABLE.kiteDamage;
        hit = { x: tmpC2.x, y: tmpC2.y, z: tmpC2.z };
      }
    }
    if (!hit) continue;
    k.integrity -= (dmg / l.lo.line.resistencia) * dt;
    if (k.integrity <= 0) {
      k.integrity = 0;
      k.broken = true;
      k.tensionN = k.tension = k.stress = 0;
    }
    out.push({ id: l.id, point: hit });
  }
  return out;
}
