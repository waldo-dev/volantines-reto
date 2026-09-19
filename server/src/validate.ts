import { MANEUVER, PHYS, type Loadout, type NetState } from '@volantines/shared';

/**
 * Validación de lo que manda cada cliente en línea (fase 0). El cliente simula su propio vuelo, así que el
 * servidor revisa que sea físicamente posible y lo corrige si no: nadie puede teletransportarse, alargar el
 * hilo más allá del carrete ni poner su volantín donde quiera para cortar a otros.
 */
export const LIMITS = {
  walk: 6 * 1.5 + 1, // m/s: corriendo libre (6 m/s) con holgura para el lag
  worldRadius: 262,
  kiteSpeed: 60, // m/s
  hand: 1.25, // altura de la mano sobre los pies
  lineSlack: 1.08, // el volantín puede estar un poco más lejos que el hilo (el hilo se estira y la red interpola)
  lineExtra: 3, // m de holgura extra
  ropeExtra: 4, // m: ningún punto del hilo más lejos que el largo + esto
  ropeMaxNumbers: 36, // 12 puntos
  minDt: 0.05, // s: dos estados muy seguidos se miden como si hubiera pasado esto
};

export type Issue = 'nan' | 'world' | 'speed' | 'reel' | 'reel-rate' | 'kite-far' | 'kite-speed' | 'rope';

const finite = (...v: unknown[]) => v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Estado anterior aceptado de este jugador y cuándo llegó (s). */
export interface Accepted {
  s: NetState;
  at: number;
}

/**
 * Revisa y corrige un estado. Devuelve null si no se puede usar (números inválidos) o el estado corregido
 * y la lista de problemas que se encontraron.
 */
export function validateState(prev: Accepted | null, next: NetState, now: number, lo: Loadout): { state: NetState; issues: Issue[] } | null {
  if (!next || !Array.isArray(next.p) || next.p.length !== 3 || !finite(...next.p, next.f, next.fid)) return null;
  if (!Array.isArray(next.v) || !finite(...next.v)) return null;
  const k = next.k;
  if (k && (!Array.isArray(k.p) || !Array.isArray(k.v) || !finite(...k.p, ...k.v, k.h, k.a, k.L, k.r, k.T, k.w))) return null;

  const issues: Issue[] = [];
  const s: NetState = { ...next, p: [...next.p] as NetState['p'], v: [...next.v] as NetState['v'] };

  // Dentro del mundo
  const r = Math.hypot(s.p[0], s.p[2]);
  if (r > LIMITS.worldRadius) {
    s.p[0] *= LIMITS.worldRadius / r;
    s.p[2] *= LIMITS.worldRadius / r;
    issues.push('world');
  }

  // Nadie corre más rápido de lo posible
  const dt = prev ? Math.max(LIMITS.minDt, now - prev.at) : 0;
  if (prev) {
    const dx = s.p[0] - prev.s.p[0];
    const dz = s.p[2] - prev.s.p[2];
    const d = Math.hypot(dx, dz);
    const max = LIMITS.walk * dt + 0.5;
    if (d > max) {
      s.p[0] = prev.s.p[0] + (dx / d) * max;
      s.p[2] = prev.s.p[2] + (dz / d) * max;
      issues.push('speed');
    }
  }

  if (k) {
    const kite = { ...k, p: [...k.p] as typeof k.p, v: [...k.v] as typeof k.v };
    s.k = kite;
    // El hilo no puede ser más largo que el carrete
    if (kite.L > lo.reel.maxLine + 0.5 || kite.L < 0) {
      kite.L = Math.min(lo.reel.maxLine, Math.max(0, kite.L));
      issues.push('reel');
    }
    // Ni cambiar de largo más rápido que lo que da el carrete (mismo volantín)
    const pk = prev?.s.k;
    if (pk && prev!.s.fid === s.fid) {
      const maxRate = Math.max(PHYS.reelBase * MANEUVER.tironReel, PHYS.releaseSpeed * MANEUVER.rapidRelease) * lo.reel.speed * 1.5;
      const maxDelta = maxRate * dt + 1;
      if (Math.abs(kite.L - pk.L) > maxDelta) {
        kite.L = pk.L + Math.sign(kite.L - pk.L) * maxDelta;
        issues.push('reel-rate');
      }
    }
    // El volantín no puede estar más lejos de la mano que lo que da el hilo
    const hx = s.p[0];
    const hy = s.p[1] + LIMITS.hand;
    const hz = s.p[2];
    const dx = kite.p[0] - hx;
    const dy = kite.p[1] - hy;
    const dz = kite.p[2] - hz;
    const dist = Math.hypot(dx, dy, dz);
    const maxDist = kite.L * LIMITS.lineSlack + LIMITS.lineExtra;
    if (dist > maxDist && dist > 0) {
      const f = maxDist / dist;
      kite.p = [hx + dx * f, hy + dy * f, hz + dz * f];
      issues.push('kite-far');
    }
    const sp = Math.hypot(...kite.v);
    if (sp > LIMITS.kiteSpeed) {
      const f = LIMITS.kiteSpeed / sp;
      kite.v = [kite.v[0] * f, kite.v[1] * f, kite.v[2] * f];
      issues.push('kite-speed');
    }
    // El hilo: pocos puntos, todos números y ninguno más lejos que lo que da el largo
    if (s.rope) {
      const rope = s.rope;
      let ok = Array.isArray(rope) && rope.length % 3 === 0 && rope.length >= 6 && rope.length <= LIMITS.ropeMaxNumbers && finite(...rope);
      const reach = kite.L * LIMITS.lineSlack + LIMITS.ropeExtra;
      for (let i = 0; ok && i < rope.length; i += 3) ok = Math.hypot(rope[i] - hx, rope[i + 1] - hy, rope[i + 2] - hz) <= reach;
      if (!ok) {
        // Hilo recto de la mano al volantín
        const pts: number[] = [];
        for (let i = 0; i < 10; i++) {
          const t = i / 9;
          pts.push(hx + (kite.p[0] - hx) * t, hy + (kite.p[1] - hy) * t, hz + (kite.p[2] - hz) * t);
        }
        s.rope = pts;
        issues.push('rope');
      }
    }
  }
  return { state: s, issues };
}
