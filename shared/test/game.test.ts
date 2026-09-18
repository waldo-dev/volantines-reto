import { describe, expect, it } from 'vitest';
import {
  BRIDLES,
  EMPTY_STATS,
  KITES,
  LINES,
  REELS,
  Rope,
  applyEvents,
  botThink,
  buyError,
  byId,
  createBrain,
  createKite,
  cutDamage,
  groundHeight,
  levelInfo,
  owns,
  resolveCrossings,
  segmentDistance,
  stepKite,
  type LineBody,
  type Loadout,
  type Progress,
} from '../src';

const DT = 1 / 120;
const lo = (line = 'algodon', kite = 'mediano'): Loadout => ({
  kite: byId(KITES, kite),
  line: byId(LINES, line),
  reel: byId(REELS, 'mano'),
  bridle: byId(BRIDLES, 'tranquilo'),
});

/** Dos hilos rectos que se cruzan en (0, 10, 0). */
function crossedLines(lineA = 'algodon', lineB = 'algodon'): [LineBody, LineBody] {
  const mk = (id: string, from: [number, number, number], to: [number, number, number], line: string): LineBody => {
    const rope = new Rope(10);
    rope.reset({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] });
    const kite = createKite({ x: from[0], y: from[1], z: from[2] }, 1, 0);
    kite.tension = 0.5;
    kite.lineLength = 57; // ya encumbrado: pasó la protección de encumbre
    kite.pos = { x: to[0], y: to[1] + 20, z: to[2] };
    return { id, pts: rope.pts, kite, lo: lo(line) };
  };
  return [mk('a', [-20, 10, -20], [20, 10.1, 20], lineA), mk('b', [-20, 10, 20], [20, 10, -20], lineB)];
}

describe('cruce de hilos', () => {
  it('mide la distancia entre segmentos que se cruzan', () => {
    const c1 = { x: 0, y: 0, z: 0 };
    const c2 = { x: 0, y: 0, z: 0 };
    const d = segmentDistance({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0.2, z: -1 }, { x: 0, y: 0.2, z: 1 }, c1, c2);
    expect(d).toBeCloseTo(0.2, 5);
  });

  it('el hilo que corre por el cruce corta al que está quieto', () => {
    const [a, b] = crossedLines();
    a.kite.lineRate = -3; // A tira
    let t = 0;
    while (!a.kite.broken && !b.kite.broken && t < 20) {
      resolveCrossings([a, b], DT);
      t += DT;
    }
    expect(b.kite.broken).toBe(true);
    expect(a.kite.broken).toBe(false);
    expect(t).toBeGreaterThan(1);
    expect(t).toBeLessThan(8);
  });

  it('un mejor hilo corta más y aguanta más', () => {
    const [a, b] = crossedLines('campeonato', 'algodon');
    expect(cutDamage(a, b, true)).toBeGreaterThan(cutDamage(b, a, true) * 2);
  });

  it('sin contacto la integridad se recupera', () => {
    const [a, b] = crossedLines();
    b.pts.forEach((p) => (p.y += 30));
    a.kite.integrity = 50;
    resolveCrossings([a, b], 1);
    expect(a.kite.integrity).toBe(52);
  });
});

describe('guardar el volantín', () => {
  it('recoger todo el hilo lo guarda en la mano', () => {
    const anchor = { x: 0, y: groundHeight(0, 0) + 1.25, z: 0 };
    const k = createKite(anchor, 1, 0);
    const wind = { x: 6, y: 0, z: 0 };
    for (let i = 0; i < 20 / DT && !k.stowed; i++) stepKite(k, lo(), { tirar: true, soltar: false, dirX: 0 }, anchor, { x: 0, y: 0, z: 0 }, wind, DT);
    expect(k.stowed).toBe(true);
    stepKite(k, lo(), { tirar: false, soltar: false, dirX: 0 }, anchor, { x: 0, y: 0, z: 0 }, wind, DT);
    expect(k.pos).toEqual(anchor);
  });
});

describe('bots', () => {
  it('un bot encumbra solo', () => {
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const anchor = { x: 0, y: groundHeight(0, 0) + 1.25, z: 0 };
    const k = createKite(anchor, 1, 0);
    const brain = createBrain(rand, 0.7);
    const wind = { x: 6, y: 0, z: 0 };
    for (let i = 0; i < 40 / DT; i++) {
      const input = botThink(brain, { id: 'bot', anchor, kite: k, lo: lo() }, [], { x: 1, y: 0, z: 0 }, DT, rand);
      stepKite(k, lo(), input, anchor, { x: 0, y: 0, z: 0 }, wind, DT);
    }
    expect(k.broken).toBe(false);
    expect(k.pos.y - anchor.y).toBeGreaterThan(15);
    expect(brain.mode).not.toBe('encumbrar');
  });
});

describe('progresión', () => {
  const fresh = (): Progress => ({ xp: 0, coins: 0, stats: { ...EMPTY_STATS }, achievements: [], owned: [] });

  it('paga cortes, capturas y tiempo de vuelo, y desbloquea logros', () => {
    const p = fresh();
    const r = applyEvents(p, { flightSeconds: 25, cuts: 1, captures: 1, bestAltitude: 30 }, 30);
    // 2 (vuelo) + 25 (corte) + 30 (captura) + 20 (primer encumbre) + 50 (comisión) + 40 (pescador)
    expect(r.coins).toBe(167);
    expect(p.achievements).toEqual(expect.arrayContaining(['primer-encumbre', 'comision', 'pescador']));
    expect(p.xp).toBe(334);
    expect(levelInfo(p.xp).level).toBe(3);
  });

  it('no deja inflar los reportes', () => {
    const p = fresh();
    applyEvents(p, { flightSeconds: 99999, cuts: 500 }, 10);
    expect(p.stats.flightSeconds).toBeLessThanOrEqual(15);
    expect(p.stats.cuts).toBeLessThanOrEqual(4);
  });

  it('las compras piden nivel y monedas', () => {
    const p = fresh();
    expect(owns(p, 'kite:mediano')).toBe(true);
    expect(buyError(p, 'kite:grande')).toMatch(/nivel 5/);
    p.xp = 1500;
    expect(buyError(p, 'kite:grande')).toMatch(/monedas/);
    p.coins = 1000;
    expect(buyError(p, 'kite:grande')).toBeNull();
  });
});

describe('enganche de hilos', () => {
  it('cruzados vistos desde arriba con 4 m de diferencia, el de arriba se monta', () => {
    const [a, b] = crossedLines();
    b.pts.forEach((p) => (p.y -= 4));
    const c = resolveCrossings([a, b], DT);
    expect(c).toHaveLength(1);
  });

  it('cruzados siguen raspándose aunque se separen un poco', () => {
    const hooks = new Set<string>();
    const [a, b] = crossedLines();
    resolveCrossings([a, b], DT, hooks);
    expect(hooks.size).toBe(1);
    b.pts.forEach((p) => (p.y += 1.5)); // se separan 1,5 m: siguen enganchados
    expect(resolveCrossings([a, b], DT, hooks)).toHaveLength(1);
    b.pts.forEach((p) => (p.y += 40)); // 41,5 m: se sueltan
    expect(resolveCrossings([a, b], DT, hooks)).toHaveLength(0);
    expect(hooks.size).toBe(0);
  });
});

describe('protección al encumbrar', () => {
  it('con poco hilo no hay cruces', () => {
    const [a, b] = crossedLines();
    a.kite.lineLength = 10;
    expect(resolveCrossings([a, b], DT)).toHaveLength(0);
  });
});
