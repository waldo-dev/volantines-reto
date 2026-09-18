import { describe, expect, it } from 'vitest';
import {
  BRIDLES,
  byId,
  createKite,
  groundHeight,
  KITES,
  LINES,
  REELS,
  stepKite,
  windAt,
  type KiteInput,
  type KiteState,
  type Loadout,
} from '../src';

const DT = 1 / 120;
const HOLD: KiteInput = { tirar: false, soltar: false, dirX: 0 };
const STILL = { x: 0, y: 0, z: 0 };

const loadout = (kite: string, line = 'algodon', bridle = 'tranquilo', reel = 'mano'): Loadout => ({
  kite: byId(KITES, kite),
  line: byId(LINES, line),
  reel: byId(REELS, reel),
  bridle: byId(BRIDLES, bridle),
});

const anchorAt = () => ({ x: 0, y: groundHeight(0, 0) + 1.25, z: 0 });

/** Encumbra soltando hilo hasta 50 m con viento moderado y luego aplica `input`. */
function simulate(lo: Loadout, input: KiteInput, seconds: number, windSpeed = 6) {
  const anchor = anchorAt();
  const k = createKite(anchor, 1, 0);
  const launch = { x: 6, y: 0, z: 0 };
  for (let i = 0; i < 120 / DT && k.lineLength < 50; i++) stepKite(k, lo, { ...HOLD, soltar: true }, anchor, STILL, launch, DT);
  const wind = { x: windSpeed, y: 0, z: 0 };
  for (let i = 0; i < seconds / DT; i++) stepKite(k, lo, input, anchor, STILL, wind, DT);
  return { k, anchor };
}

function run(k: KiteState, lo: Loadout, input: KiteInput, seconds: number, windSpeed = 6, each?: (k: KiteState) => void) {
  const anchor = anchorAt();
  for (let i = 0; i < seconds / DT; i++) {
    stepKite(k, lo, input, anchor, STILL, { x: windSpeed, y: 0, z: 0 }, DT);
    each?.(k);
  }
}

describe('volantín', () => {
  it('sube con viento constante y queda a sotavento', () => {
    const { k, anchor } = simulate(loadout('mediano'), HOLD, 5);
    expect(k.broken).toBe(false);
    expect(k.pos.y - anchor.y).toBeGreaterThan(20);
    expect(k.pos.x).toBeGreaterThan(0);
  });

  it('el hilo no supera el largo máximo del carrete', () => {
    const { k } = simulate(loadout('mediano'), { ...HOLD, soltar: true }, 30);
    expect(k.lineLength).toBeLessThanOrEqual(80);
  });

  it('un volantín grande tensa más el hilo que uno chico', () => {
    const small = simulate(loadout('cambucha'), HOLD, 5).k;
    const big = simulate(loadout('grande'), HOLD, 5).k;
    expect(big.tensionN).toBeGreaterThan(small.tensionN * 2);
  });

  it('dirigir a la derecha mueve el volantín hacia +z', () => {
    const { k } = simulate(loadout('mediano', 'algodon', 'normal'), { ...HOLD, dirX: 1 }, 3);
    expect(k.pos.z).toBeGreaterThan(5);
  });

  it('tirar un gigante con viento fuerte gasta y corta el hilo básico, no el de campeonato', () => {
    const pull = { ...HOLD, tirar: true };
    expect(simulate(loadout('gigante', 'algodon'), pull, 8, 9).k.broken).toBe(true);
    expect(simulate(loadout('mediano', 'campeonato'), pull, 8, 6).k.broken).toBe(false);
  });

  it('con el hilo al máximo se puede sostener y recoger harto rato sin que se corte', () => {
    const lo = loadout('mediano', 'algodon', 'normal');
    const { k } = simulate(lo, { ...HOLD, soltar: true }, 60, 7);
    expect(k.lineLength).toBeCloseTo(80, 0);
    run(k, lo, HOLD, 30, 7);
    run(k, lo, { ...HOLD, tirar: true }, 10, 7);
    expect(k.broken).toBe(false);
  });

  it('la sobretensión gasta el hilo de a poco en vez de cortarlo de inmediato', () => {
    const lo = loadout('gigante', 'algodon');
    const { k } = simulate(lo, HOLD, 0, 9);
    let firstOver = -1;
    let brokeAt = -1;
    let t = 0;
    run(k, lo, { ...HOLD, tirar: true }, 20, 9, (s) => {
      t += DT;
      if (firstOver < 0 && s.stress > 1) firstOver = t;
      if (brokeAt < 0 && s.broken) brokeAt = t;
    });
    expect(firstOver).toBeGreaterThan(-1);
    if (brokeAt >= 0) expect(brokeAt - firstOver).toBeGreaterThan(1.5);
  });

  it('el tirante cabeceador se mueve solo mucho más que el tranquilo', () => {
    const sway = (bridle: string) => {
      const lo = loadout('mediano', 'algodon', bridle);
      const { k } = simulate(lo, HOLD, 2);
      let max = 0;
      run(k, lo, HOLD, 20, 6, (s) => (max = Math.max(max, Math.abs(s.heading))));
      return max;
    };
    expect(sway('tranquilo')).toBeLessThan(0.4);
    expect(sway('cabeceador')).toBeGreaterThan(0.8);
  });

  it('tirar con la punta hacia arriba lo sube; con la punta hacia abajo lo baja', () => {
    const lo = loadout('mediano');
    const up = simulate(lo, HOLD, 3).k;
    const down = structuredClone(up);
    down.heading = Math.PI * 0.95;
    const y0 = up.pos.y;
    run(up, lo, { ...HOLD, tirar: true }, 0.4);
    run(down, lo, { ...HOLD, tirar: true }, 0.4);
    expect(up.pos.y).toBeGreaterThan(y0);
    expect(down.pos.y).toBeLessThan(y0);
  });

  it('encumbra soltando hilo desde el inicio con el viento del juego', () => {
    const lo = loadout('mediano', 'algodon', 'normal');
    const anchor = { x: 0, y: groundHeight(0, 0) + 1.4, z: 0 };
    const w0 = windAt(0, 5);
    const k = createKite(anchor, Math.cos(w0.angle), Math.sin(w0.angle));
    for (let i = 0; i < 16 / DT; i++) {
      const alt = k.pos.y - groundHeight(k.pos.x, k.pos.z);
      stepKite(k, lo, { ...HOLD, soltar: true }, anchor, STILL, windAt(i * DT, alt), DT);
    }
    expect(k.lineLength).toBeGreaterThan(25);
    expect(k.pos.y - groundHeight(k.pos.x, k.pos.z)).toBeGreaterThan(15);
  });
});
