import { afterEach, describe, expect, it } from 'vitest';
import {
  BRIDLES,
  CABLE,
  EMPTY_STATS,
  KITES,
  LINES,
  MAPS,
  REELS,
  Rope,
  WIND,
  activeMap,
  applyEvents,
  botThink,
  byId,
  cableSegments,
  createBrain,
  createKite,
  groundHeight,
  inBonus,
  resolveCables,
  stepKite,
  useMap,
  walkable,
  windAt,
  type LineBody,
} from '../src';

const DT = 1 / 120;
afterEach(() => useMap('cerro'));

describe('escenarios', () => {
  it('cada mapa trae su terreno y su viento', () => {
    useMap('cerro');
    const cerro = groundHeight(0, 0);
    expect(WIND.base).toBe(5.5);
    useMap('valparaiso');
    expect(groundHeight(0, 0)).toBeGreaterThan(cerro + 4);
    expect(WIND.base).toBe(activeMap().wind.base);
    useMap('playa');
    expect(WIND.base).toBeGreaterThan(7);
    // En la playa el mar está hacia -x: ahí no se camina
    expect(walkable(0, 0)).toBe(true);
    expect(walkable(-120, 0)).toBe(false);
    expect(groundHeight(-120, 0)).toBeLessThan(activeMap().sea!.level);
  });

  it('en todos los mapas se puede encumbrar desde el centro', () => {
    for (const m of MAPS) {
      useMap(m.id);
      let seed = 5;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const anchor = { x: 0, y: groundHeight(0, 0) + 1.25, z: 0 };
      const lo = { kite: byId(KITES, 'mediano'), line: byId(LINES, 'algodon'), reel: byId(REELS, 'mano'), bridle: byId(BRIDLES, 'normal') };
      const k = createKite(anchor, 1, 0, 2);
      const brain = createBrain(rand, 0.6);
      for (let i = 0; i < 60 / DT; i++) {
        const input = botThink(brain, { id: 'b', anchor, kite: k, lo }, [], { x: 1, y: 0, z: 0 }, DT, rand);
        stepKite(k, lo, input, anchor, { x: 0, y: 0, z: 0 }, windAt(i * DT, k.pos.y - groundHeight(k.pos.x, k.pos.z)), DT);
      }
      expect(k.broken, `${m.id}: se cortó`).toBe(false);
      expect(k.pos.y - anchor.y, `${m.id}: no subió`).toBeGreaterThan(15);
    }
  });

  it('la zona de bono es un cilindro en el cielo', () => {
    const parque = MAPS.find((m) => m.id === 'parque')!;
    const b = parque.bonus!;
    expect(inBonus(parque, { x: b.x, y: (b.y0 + b.y1) / 2, z: b.z })).toBe(true);
    expect(inBonus(parque, { x: b.x, y: b.y0 - 5, z: b.z })).toBe(false);
    expect(inBonus(parque, { x: b.x + b.r + 1, y: b.y0 + 5, z: b.z })).toBe(false);
    expect(inBonus(MAPS[0], { x: 0, y: 40, z: 0 })).toBe(false);
  });

  it('cortar dentro de la zona paga extra, pero no sin cortes', () => {
    const p = { xp: 0, coins: 0, stats: { ...EMPTY_STATS }, achievements: ['comision'], owned: [] as string[] };
    const r = applyEvents(p, { cuts: 1, bonusCuts: 1 }, 30);
    expect(r.coins).toBe(25 + 20 + 50);
    const q = { xp: 0, coins: 0, stats: { ...EMPTY_STATS }, achievements: [] as string[], owned: [] as string[] };
    applyEvents(q, { cuts: 0, bonusCuts: 3 }, 30);
    expect(q.stats.bonusCuts).toBe(0);
  });
});

describe('cables del tendido', () => {
  it('un hilo que pasa por un cable se gasta hasta cortarse', () => {
    useMap('valparaiso');
    const cables = cableSegments(activeMap(), groundHeight);
    expect(cables.length).toBeGreaterThan(3);
    const c = cables[0];
    // Hilo que cruza el cable por el medio
    const mid = { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2, z: (c.a.z + c.b.z) / 2 };
    const rope = new Rope(10);
    rope.reset({ x: mid.x, y: mid.y - 8, z: mid.z - 10 }, { x: mid.x, y: mid.y + 8, z: mid.z + 10 });
    const kite = createKite({ x: 0, y: 0, z: 0 }, 1, 0);
    kite.pos = { x: mid.x, y: mid.y + 8, z: mid.z + 10 };
    const line: LineBody = { id: 'a', pts: rope.pts, kite, lo: { kite: byId(KITES, 'mediano'), line: byId(LINES, 'algodon'), reel: byId(REELS, 'mano'), bridle: byId(BRIDLES, 'normal') } };
    expect(resolveCables([line], cables, 1)).toHaveLength(1);
    expect(kite.integrity).toBeCloseTo(100 - CABLE.damage);
    for (let i = 0; i < 20 && !kite.broken; i++) resolveCables([line], cables, 1);
    expect(kite.broken).toBe(true);
    // Lejos de los cables no pasa nada
    const far = { ...line, id: 'b', kite: createKite({ x: 0, y: 0, z: 0 }, 1, 0), pts: new Rope(10).pts };
    far.kite.pos = { x: -300, y: 50, z: 300 };
    expect(resolveCables([far], cables, 1)).toHaveLength(0);
  });
});
