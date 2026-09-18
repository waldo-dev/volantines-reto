import { clamp, type V3 } from './vec';
import { PHYS, type KiteState, type Loadout } from './kite';

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
  recover: 2, // integridad que se recupera por segundo sin contacto
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
}

export interface Contact {
  a: string;
  b: string;
  point: V3;
  /** Daño por segundo que cada hilo le hace al otro. */
  damageToA: number;
  damageToB: number;
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

/** Daño por segundo que el hilo A le hace al hilo B cuando se cruzan. */
export function cutDamage(a: LineBody, b: LineBody, aAbove: boolean): number {
  const alt = aAbove ? 1.2 : 0.8;
  return (CUT.K * a.lo.line.filo * (0.4 + a.kite.tension) * (0.2 + slideOf(a.kite, a.lo)) * alt) / b.lo.line.resistencia;
}

/** Un hilo participa en cruces si está volando y ya pasó la protección de encumbre. */
const active = (l: LineBody) =>
  !l.kite.broken && !l.kite.stowed && l.kite.lineLength >= CUT.minLine && l.kite.pos.y - l.pts[0].y >= CUT.minHeight;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Busca cruces entre todos los hilos y aplica el desgaste a la integridad de cada uno.
 * Dos hilos que se tocan quedan enganchados (`hooks`) y siguen raspándose hasta separarse o cortarse,
 * como en una comisión de verdad. Un hilo que llega a 0 queda cortado (`kite.broken`).
 */
export function resolveCrossings(lines: LineBody[], dt: number, hooks: Set<string> = new Set()): Contact[] {
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
      for (let si = CUT.skipNearHand; si < A.pts.length - 1; si++) {
        for (let sj = CUT.skipNearHand; sj < B.pts.length - 1; sj++) {
          const a0 = A.pts[si], a1 = A.pts[si + 1], b0 = B.pts[sj], b1 = B.pts[sj + 1];
          const d = segmentDistance(a0, a1, b0, b1, tmpC1, tmpC2);
          if (d < best) {
            best = d;
            aAbove = tmpC1.y >= tmpC2.y;
            point = { x: (tmpC1.x + tmpC2.x) / 2, y: (tmpC1.y + tmpC2.y) / 2, z: (tmpC1.z + tmpC2.z) / 2 };
          }
          const dy = planCrossing(a0, a1, b0, b1, tmpC1);
          if (dy !== null && Math.abs(dy) * CUT.verticalFactor < best) {
            best = Math.abs(dy) * CUT.verticalFactor;
            aAbove = dy >= 0;
            point = { x: tmpC1.x, y: tmpC1.y, z: tmpC1.z };
          }
        }
      }
      const key = pairKey(A.id, B.id);
      const hooked = hooks.has(key);
      if (!point || best > (hooked ? CUT.holdDist : CUT.contactDist)) {
        hooks.delete(key);
        continue;
      }
      hooks.add(key);
      const damageToB = cutDamage(A, B, aAbove);
      const damageToA = cutDamage(B, A, !aAbove);
      A.kite.integrity -= damageToA * dt;
      B.kite.integrity -= damageToB * dt;
      touched.add(A.id).add(B.id);
      contacts.push({ a: A.id, b: B.id, point, damageToA, damageToB });
    }
  }
  // Enganches de hilos que ya no están en juego
  const alive = new Set(lines.filter(active).map((l) => l.id));
  for (const key of hooks) {
    const [a, b] = key.split('|');
    if (!alive.has(a) || !alive.has(b)) hooks.delete(key);
  }
  for (const l of lines) {
    if (!active(l)) continue;
    if (!touched.has(l.id)) l.kite.integrity = Math.min(100, l.kite.integrity + CUT.recover * dt);
    if (l.kite.integrity <= 0) {
      l.kite.integrity = 0;
      l.kite.broken = true;
      l.kite.tensionN = l.kite.tension = l.kite.stress = 0;
    }
  }
  return contacts;
}
