import { describe, expect, it } from 'vitest';
import {
  BRIDLES,
  COMBO,
  CUT,
  EMPTY_STATS,
  KITES,
  LINES,
  REELS,
  Rope,
  applyEvents,
  byId,
  comboName,
  createKite,
  cutDamage,
  groundHeight,
  isUpset,
  newCombo,
  registerCut,
  resetCombo,
  resolveCrossings,
  stepKite,
  streakActive,
  type Hook,
  type KiteInput,
  type LineBody,
  type Loadout,
  type Progress,
} from '../src';

const DT = 1 / 120;
const HOLD: KiteInput = { tirar: false, soltar: false, dirX: 0 };
const STILL = { x: 0, y: 0, z: 0 };
const lo = (line = 'algodon'): Loadout => ({
  kite: byId(KITES, 'mediano'),
  line: byId(LINES, line),
  reel: byId(REELS, 'mano'),
  bridle: byId(BRIDLES, 'normal'),
});

/** Volantín encumbrado a 50 m con viento de 6 m/s. */
function flying() {
  const anchor = { x: 0, y: groundHeight(0, 0) + 1.25, z: 0 };
  const k = createKite(anchor, 1, 0);
  const wind = { x: 6, y: 0, z: 0 };
  for (let i = 0; i < 120 / DT && k.lineLength < 50; i++) stepKite(k, lo(), { ...HOLD, soltar: true }, anchor, STILL, wind, DT);
  for (let i = 0; i < 5 / DT; i++) stepKite(k, lo(), HOLD, anchor, STILL, wind, DT);
  const step = (input: KiteInput, seconds: number) => {
    for (let i = 0; i < seconds / DT; i++) stepKite(k, lo(), input, anchor, STILL, wind, DT);
  };
  return { k, step };
}

/** Dos hilos rectos que se cruzan en (0, 10, 0), en la parte media de ambos. */
function crossedLines(lineA = 'algodon', lineB = 'algodon'): [LineBody, LineBody] {
  const mk = (id: string, from: [number, number, number], to: [number, number, number], line: string): LineBody => {
    const rope = new Rope(10);
    rope.reset({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] });
    const kite = createKite({ x: from[0], y: from[1], z: from[2] }, 1, 0);
    kite.tension = 0.5;
    kite.lineLength = 57;
    kite.pos = { x: to[0], y: to[1] + 20, z: to[2] };
    return { id, pts: rope.pts, kite, lo: lo(line) };
  };
  return [mk('a', [-20, 10, -20], [20, 10.1, 20], lineA), mk('b', [-20, 10, 20], [20, 10, -20], lineB)];
}

describe('maniobras', () => {
  it('el tirón seco gira la punta de golpe hacia donde diriges y recoge hilo rápido', () => {
    const { k, step } = flying();
    const len = k.lineLength;
    const heading = k.heading;
    step({ ...HOLD, tiron: true, dirX: 1 }, DT);
    expect(k.maneuver).toBe(1);
    step({ ...HOLD, dirX: 1 }, 0.3);
    expect(k.heading - heading).toBeGreaterThan(0.3);
    expect(len - k.lineLength).toBeGreaterThan(1.5); // 0,3 s a 2,2 × 3 m/s
  });

  it('el tirón tiene enfriamiento', () => {
    const { k, step } = flying();
    step({ ...HOLD, tiron: true }, DT);
    step(HOLD, 0.2);
    step({ ...HOLD, tiron: true }, DT);
    expect(k.maneuverAge).toBeGreaterThan(0.15); // el segundo no contó
    step(HOLD, 0.6);
    step({ ...HOLD, tiron: true }, DT);
    expect(k.maneuverAge).toBeLessThan(0.02);
  });

  it('dar cuerda rápido suelta más hilo que soltar normal y marca una largada', () => {
    const a = flying();
    const b = flying();
    const la = a.k.lineLength;
    const lb = b.k.lineLength;
    a.step({ ...HOLD, soltar: true }, 1);
    b.step({ ...HOLD, soltar: true, rapido: true }, 1);
    expect(b.k.maneuver).toBe(2);
    expect(b.k.lineLength - lb).toBeGreaterThan((a.k.lineLength - la) * 1.5);
  });
});

describe('golpes críticos', () => {
  it('un tirón justo al cruzarse quita integridad de una vez', () => {
    const [a, b] = crossedLines();
    a.kite.maneuver = 1;
    a.kite.maneuverAge = 0.1;
    const hooks = new Map<string, Hook>();
    const [c] = resolveCrossings([a, b], DT, hooks);
    expect(c.crits).toHaveLength(1);
    expect(c.crits[0]).toMatchObject({ by: 'a', victim: 'b', kind: 1 });
    expect(b.kite.integrity).toBeLessThan(100 - CUT.critDamage + 1);
    // Una sola vez por enganche
    expect(resolveCrossings([a, b], DT, hooks)[0].crits).toHaveLength(0);
  });

  it('una maniobra vieja o un cruce viejo no dan crítico', () => {
    const [a, b] = crossedLines();
    a.kite.maneuver = 2;
    a.kite.maneuverAge = 2;
    expect(resolveCrossings([a, b], DT)[0].crits).toHaveLength(0);
    const hooks = new Map<string, Hook>();
    const [c, d] = crossedLines();
    resolveCrossings([c, d], DT, hooks);
    hooks.forEach((h) => (h.age = 1));
    c.kite.maneuver = 1;
    c.kite.maneuverAge = 0;
    expect(resolveCrossings([c, d], DT, hooks)[0].crits).toHaveLength(0);
  });
});

describe('hilos', () => {
  it('cada hilo se recupera a su ritmo', () => {
    const [a, b] = crossedLines('campeonato', 'algodon');
    b.pts.forEach((p) => (p.y += 30));
    b.kite.pos.y += 30;
    a.kite.integrity = 50;
    b.kite.integrity = 50;
    resolveCrossings([a, b], 1);
    expect(a.kite.integrity).toBeCloseTo(53.5);
    expect(b.kite.integrity).toBeCloseTo(52);
  });

  it('la zona débil (cerca del volantín) recibe más daño', () => {
    const [a, b] = crossedLines();
    expect(cutDamage(a, b, true, true)).toBeCloseTo(cutDamage(a, b, true) * CUT.weakFactor);
  });

  it('la racha da más filo y recuperación', () => {
    const [a, b] = crossedLines();
    const normal = cutDamage(a, b, true);
    a.boost = true;
    expect(cutDamage(a, b, true)).toBeCloseTo(normal * CUT.boostFilo);
  });

  it('cortar con peor hilo es "contra la corriente"', () => {
    expect(isUpset(byId(LINES, 'algodon'), byId(LINES, 'fino'))).toBe(true);
    expect(isUpset(byId(LINES, 'fino'), byId(LINES, 'algodon'))).toBe(false);
  });
});

describe('combos', () => {
  it('cuenta cortes seguidos y activa la racha en el tercero', () => {
    const c = newCombo();
    expect(registerCut(c, 0)).toEqual({ combo: 1, streakStarted: false });
    expect(registerCut(c, 10)).toEqual({ combo: 2, streakStarted: false });
    expect(registerCut(c, 20)).toEqual({ combo: 3, streakStarted: true });
    expect(streakActive(c, 20 + COMBO.streakTime - 1)).toBe(true);
    expect(streakActive(c, 20 + COMBO.streakTime + 1)).toBe(false);
    expect(comboName(2)).toBe('DOBLE');
    expect(comboName(12)).toBe('COMBO ×12');
  });

  it('se pierde al pasar mucho rato o al ser cortado', () => {
    const c = newCombo();
    registerCut(c, 0);
    expect(registerCut(c, COMBO.window + 1).combo).toBe(1);
    registerCut(c, COMBO.window + 2);
    resetCombo(c);
    expect(registerCut(c, COMBO.window + 3).combo).toBe(1);
  });
});

describe('premios de combate', () => {
  const fresh = (): Progress => ({ xp: 0, coins: 0, stats: { ...EMPTY_STATS }, achievements: ['comision', 'primer-encumbre'], owned: [] });

  it('paga críticos, cortes contra la corriente y combos', () => {
    const p = fresh();
    const r = applyEvents(p, { cuts: 2, crits: 1, upsets: 1, comboCuts: 1, bestCombo: 2 }, 30);
    // 50 (cortes) + 5 (crítico) + 25 (contra la corriente) + 15 (combo) + logros: 30 + 60 + 80
    expect(r.coins).toBe(265);
    expect(p.achievements).toEqual(expect.arrayContaining(['critico', 'doblete', 'contra-corriente']));
  });

  it('no deja inflar combos ni premios sin cortes', () => {
    const p = fresh();
    applyEvents(p, { cuts: 0, upsets: 5, comboCuts: 5, bestCombo: 9, crits: 999 }, 10);
    expect(p.stats.upsets).toBe(0);
    expect(p.stats.comboCuts).toBe(0);
    expect(p.stats.bestCombo).toBe(0);
    expect(p.stats.crits).toBeLessThanOrEqual(5);
  });
});
