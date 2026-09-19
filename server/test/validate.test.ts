import { describe, expect, it } from 'vitest';
import { DEFAULT_GEAR, gearLoadout, type NetState } from '@volantines/shared';
import { LIMITS, validateState } from '../src/validate';

const lo = gearLoadout(DEFAULT_GEAR); // carrete de mano: 80 m

/** Jugador parado en (x, 0, z) con su volantín a `dist` m en +x y 30 m de alto, con `L` m de hilo. */
function st(x: number, z: number, fid = 1, L = 60, dist = 40): NetState {
  const hand = [x, LIMITS.hand, z];
  const kite: [number, number, number] = [x + dist, 30, z];
  const rope: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    rope.push(hand[0] + (kite[0] - hand[0]) * t, hand[1] + (kite[1] - hand[1]) * t, hand[2] + (kite[2] - hand[2]) * t);
  }
  return { p: [x, 0, z], v: [0, 0], f: 0, fid, k: { p: kite, v: [1, 0, 0], h: 0, a: 0.7, L, r: 0, T: 0.5, w: 0, g: 0, s: 0 }, rope };
}

describe('validación de estados del cliente', () => {
  it('un estado normal pasa sin cambios', () => {
    const a = validateState(null, st(0, 0), 0, lo)!;
    expect(a.issues).toEqual([]);
    const b = validateState({ s: a.state, at: 0 }, st(2, 0), 1, lo)!;
    expect(b.issues).toEqual([]);
    expect(b.state.p).toEqual([2, 0, 0]);
  });

  it('números inválidos: el estado se ignora', () => {
    expect(validateState(null, { ...st(0, 0), p: [NaN, 0, 0] }, 0, lo)).toBeNull();
    const bad = st(0, 0);
    bad.k!.L = Infinity;
    expect(validateState(null, bad, 0, lo)).toBeNull();
  });

  it('no deja teletransportarse ni salir del mundo', () => {
    const a = validateState(null, st(0, 0), 0, lo)!;
    const b = validateState({ s: a.state, at: 0 }, st(100, 0), 1, lo)!;
    expect(b.issues).toContain('speed');
    expect(b.state.p[0]).toBeLessThanOrEqual(LIMITS.walk + 0.5 + 1e-9);
    const c = validateState(null, st(900, 0), 0, lo)!;
    expect(c.issues).toContain('world');
  });

  it('el hilo no puede superar el carrete ni crecer más rápido que lo que suelta', () => {
    const a = validateState(null, st(0, 0, 1, 500, 40), 0, lo)!;
    expect(a.issues).toContain('reel');
    expect(a.state.k!.L).toBe(80);
    const b = validateState(null, st(0, 0, 1, 20, 15), 0, lo)!;
    const c = validateState({ s: b.state, at: 0 }, st(0, 0, 1, 75, 15), 0.1, lo)!;
    expect(c.issues).toContain('reel-rate');
    expect(c.state.k!.L).toBeLessThan(30);
    // Con un volantín nuevo (otro fid) el largo puede cambiar de golpe
    expect(validateState({ s: b.state, at: 0 }, st(0, 0, 2, 75, 15), 0.1, lo)!.issues).not.toContain('reel-rate');
  });

  it('el volantín no puede estar más lejos que lo que da el hilo; el hilo se rehace recto', () => {
    const v = validateState(null, st(0, 0, 1, 20, 150), 0, lo)!;
    expect(v.issues).toEqual(expect.arrayContaining(['kite-far', 'rope']));
    const k = v.state.k!.p;
    expect(Math.hypot(k[0], k[1] - LIMITS.hand, k[2])).toBeLessThanOrEqual(20 * LIMITS.lineSlack + LIMITS.lineExtra + 1e-6);
    expect(v.state.rope).toHaveLength(30);
  });

  it('volantín demasiado rápido y hilo con demasiados puntos', () => {
    const s = st(0, 0);
    s.k!.v = [500, 0, 0];
    s.rope = new Array(300).fill(0);
    const v = validateState(null, s, 0, lo)!;
    expect(v.issues).toEqual(expect.arrayContaining(['kite-speed', 'rope']));
    expect(Math.hypot(...v.state.k!.v)).toBeCloseTo(LIMITS.kiteSpeed);
  });
});
