import { describe, expect, it } from 'vitest';
import {
  BRIDLES,
  CATALOG,
  EMPTY_STATS,
  KITES,
  LINES,
  PHYS,
  REELS,
  Rope,
  applyEvents,
  botThink,
  byId,
  createBrain,
  createKite,
  defaultAmarre,
  gearLoadout,
  groundHeight,
  resolveTailCuts,
  stepKite,
  tailSegment,
  tuneBridle,
  windAt,
  type KiteInput,
  type KiteState,
  type LineBody,
  type Loadout,
} from '../src';

const DT = 1 / 120;
const HOLD: KiteInput = { tirar: false, soltar: false, dirX: 0 };
const STILL = { x: 0, y: 0, z: 0 };
const lo = (kite: string, bridle = 'normal'): Loadout => ({
  kite: byId(KITES, kite),
  line: byId(LINES, 'algodon'),
  reel: byId(REELS, 'mano'),
  bridle: byId(BRIDLES, bridle),
});

/** Encumbra a 50 m y deja volar `seconds` con `input`; `each` mira el estado en cada paso. */
function fly(l: Loadout, input: KiteInput, seconds: number, each?: (k: KiteState) => void, setup?: (k: KiteState) => void) {
  const anchor = { x: 0, y: groundHeight(0, 0) + 1.25, z: 0 };
  const k = createKite(anchor, 1, 0, 3);
  setup?.(k);
  const wind = { x: 6, y: 0, z: 0 };
  for (let i = 0; i < 120 / DT && k.lineLength < 50; i++) stepKite(k, l, { ...HOLD, soltar: true }, anchor, STILL, wind, DT);
  for (let i = 0; i < 4 / DT; i++) stepKite(k, l, HOLD, anchor, STILL, wind, DT);
  for (let i = 0; i < seconds / DT; i++) {
    stepKite(k, l, input, anchor, STILL, wind, DT);
    each?.(k);
  }
  return k;
}

const headingSpread = (l: Loadout, setup?: (k: KiteState) => void) => {
  let sum = 0;
  let n = 0;
  fly(l, HOLD, 20, (k) => {
    sum += k.heading * k.heading;
    n++;
  }, setup);
  return Math.sqrt(sum / n);
};

describe('tipos de volantín', () => {
  it('la ñecla gira la punta más rápido que el pavo', () => {
    // Sin turbulencia, para comparar solo la respuesta al dirigir
    const noise = PHYS.headingNoise;
    PHYS.headingNoise = 0;
    const turn = (id: string) => {
      const k = fly(lo(id), HOLD, 0);
      const h0 = k.heading;
      const anchor = { x: 0, y: groundHeight(0, 0) + 1.25, z: 0 };
      let peak = 0;
      for (let i = 0; i < 1.5 / DT; i++) {
        stepKite(k, lo(id), { ...HOLD, dirX: 1 }, anchor, STILL, { x: 6, y: 0, z: 0 }, DT);
        peak = Math.max(peak, k.heading - h0);
      }
      return peak;
    };
    const necla = turn('necla');
    const pavo = turn('gigante');
    PHYS.headingNoise = noise;
    expect(necla).toBeGreaterThan(pavo * 1.25);
  });

  it('la ñecla es más nerviosa que el chonchón', () => {
    expect(headingSpread(lo('necla'))).toBeGreaterThan(headingSpread(lo('chonchon')) * 1.5);
  });

  it('con la cola cortada el chonchón cabecea mucho más', () => {
    const whole = headingSpread(lo('chonchon'));
    const cut = headingSpread(lo('chonchon'), (k) => (k.tailCut = true));
    expect(cut).toBeGreaterThan(whole * 1.5);
  });

  it('todos los volantines se pueden encumbrar y volar sin cortarse solos', () => {
    for (const k of KITES) {
      for (const bridle of ['tranquilo', 'normal', 'cabeceador']) {
        let seed = 11;
        const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const anchor = { x: 0, y: groundHeight(0, 0) + 1.25, z: 0 };
        const kite = createKite(anchor, 1, 0, 5);
        const brain = createBrain(rand, 0.6);
        const l = lo(k.id, bridle);
        let low = 0;
        for (let i = 0; i < 60 / DT; i++) {
          const input = botThink(brain, { id: 'b', anchor, kite, lo: l }, [], { x: 1, y: 0, z: 0 }, DT, rand);
          stepKite(kite, l, input, anchor, STILL, windAt(i * DT, kite.pos.y), DT);
          if (i * DT > 40 && kite.pos.y - anchor.y < 12) low++;
        }
        expect(kite.broken, `${k.id} con ${bridle} se cortó`).toBe(false);
        expect(kite.pos.y - anchor.y, `${k.id} con ${bridle} no subió`).toBeGreaterThan(15);
        expect(low, `${k.id} con ${bridle} se cayó`).toBeLessThan(2 / DT);
      }
    }
  });

  it('todos los volantines, hilos y tirantes están en la tienda con ids únicos', () => {
    const keys = CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of KITES) expect(keys).toContain(`kite:${k.id}`);
    for (const l of LINES) expect(keys).toContain(`line:${l.id}`);
    // Los ids viejos siguen existiendo (compras hechas antes)
    for (const id of ['cambucha', 'mediano', 'grande', 'gigante']) expect(KITES.some((k) => k.id === id)).toBe(true);
    for (const id of ['algodon', 'curado', 'fino', 'campeonato']) expect(LINES.some((l) => l.id === id)).toBe(true);
  });
});

describe('tirantes con perilla de amarre', () => {
  it('sin perilla quedan como vienen; con perilla se mueven dentro de su rango', () => {
    const normal = byId(BRIDLES, 'normal');
    expect(tuneBridle(normal, undefined)).toBe(normal);
    const calm = tuneBridle(normal, 0);
    const wild = tuneBridle(normal, 1);
    expect(calm.estabilidad).toBeGreaterThan(wild.estabilidad);
    expect(calm.nervio).toBeLessThan(wild.nervio);
    // El normal no llega a los extremos de los tirantes de maestro
    const master = byId(BRIDLES, 'maestro');
    expect(tuneBridle(master, 1).nervio).toBeGreaterThan(wild.nervio);
    expect(tuneBridle(master, 0).estabilidad).toBeGreaterThan(calm.estabilidad);
  });

  it('la posición por defecto reproduce cada tirante', () => {
    for (const b of BRIDLES) {
      const t = tuneBridle(b, defaultAmarre(b));
      expect(t.estabilidad).toBeCloseTo(b.estabilidad, 1);
    }
  });

  it('el equipo aplica la perilla', () => {
    const g = gearLoadout({ kite: 'mediano', line: 'algodon', reel: 'mano', bridle: 'cabeceador', amarre: 1 });
    expect(g.bridle.nervio).toBeCloseTo(1.95);
    expect(gearLoadout({ kite: 'nada', line: 'x', reel: 'y', bridle: 'z' }).kite.id).toBe(KITES[0].id);
  });
});

describe('cortar colas', () => {
  /** Un volantín con cola (en `pos`) y un hilo rival que pasa justo por su cola. */
  function setup(maneuver: 0 | 1, age = 0.1) {
    const mkLine = (id: string, kite: string, from: [number, number, number], to: [number, number, number]): LineBody => {
      const rope = new Rope(12);
      rope.reset({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] });
      const k = createKite({ x: from[0], y: from[1], z: from[2] }, 1, 0);
      k.lineLength = 50;
      k.pos = { x: to[0], y: to[1], z: to[2] };
      return { id, pts: rope.pts, kite: k, lo: lo(kite) };
    };
    const victim = mkLine('v', 'chonchon', [0, 10, 0], [40, 40, 0]);
    // El hilo del rival cruza por donde cuelga la cola (debajo y detrás del volantín)
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    tailSegment(victim, a, b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    const rival = mkLine('r', 'mediano', [mid.x - 30, 10, mid.z - 30], [mid.x + 10, mid.y + 20, mid.z + 10]);
    const pts = rival.pts;
    // Hilo recto que pasa exactamente por el medio de la cola
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      pts[i].x = mid.x - 30 + 60 * t;
      pts[i].y = 10 + (mid.y - 10) * 2 * t;
      pts[i].z = mid.z - 30 + 60 * t;
    }
    pts[pts.length - 1] = { ...rival.kite.pos };
    rival.kite.pos = { x: mid.x + 30, y: mid.y * 2 - 10, z: mid.z + 30 };
    pts[pts.length - 1] = { ...rival.kite.pos };
    rival.kite.maneuver = maneuver;
    rival.kite.maneuverAge = age;
    return { victim, rival };
  }

  it('un tirón (latigazo) pegado a la cola la corta', () => {
    const { victim, rival } = setup(1);
    const cuts = resolveTailCuts([victim, rival]);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ by: 'r', victim: 'v' });
    expect(victim.kite.tailCut).toBe(true);
    expect(resolveTailCuts([victim, rival])).toHaveLength(0); // ya no tiene cola
  });

  it('sin tirón, o con un tirón viejo, la cola no se corta', () => {
    expect(resolveTailCuts(Object.values(setup(0)))).toHaveLength(0);
    expect(resolveTailCuts(Object.values(setup(1, 2)))).toHaveLength(0);
  });

  it('los volantines sin cola no tienen cola que cortar', () => {
    const { victim, rival } = setup(1);
    victim.lo = lo('mediano');
    expect(resolveTailCuts([victim, rival])).toHaveLength(0);
  });

  it('cortar colas paga y da logro', () => {
    const p = { xp: 0, coins: 0, stats: { ...EMPTY_STATS }, achievements: [] as string[], owned: [] as string[] };
    const r = applyEvents(p, { tailCuts: 1 }, 30);
    expect(r.coins).toBe(10 + 40);
    expect(p.achievements).toContain('cortacolas');
  });
});
