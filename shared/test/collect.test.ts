import { describe, expect, it } from 'vitest';
import {
  BAGS,
  CATALOG,
  EMPTY_STATS,
  MAX_CAPTURE_BONUS,
  REWARDS,
  applyEvents,
  bagOf,
  canReach,
  captureValue,
  poleOf,
  sanitizeTrophy,
  trophyOf,
  type Progress,
} from '../src';

const fresh = (): Progress => ({ xp: 0, coins: 0, stats: { ...EMPTY_STATS }, achievements: [], owned: [] });

describe('mochila y colihue', () => {
  it('un volantín común a mano paga la base; uno legendario con el mejor colihue paga mucho más', () => {
    expect(captureValue('mediano', poleOf('mano'))).toBe(REWARDS.capture);
    expect(captureValue('grande', poleOf('mano'))).toBe(45); // raro ×1,5
    expect(captureValue('condor', poleOf('colihue-campeon'))).toBe(135); // legendario ×3 × 1,5
    expect(captureValue('condor', poleOf('colihue-campeon')) - REWARDS.capture).toBe(MAX_CAPTURE_BONUS);
  });

  it('el colihue alcanza más lejos y más alto', () => {
    expect(canReach(poleOf('mano'), 3, 1)).toBe(false);
    expect(canReach(poleOf('colihue-corto'), 3, 1)).toBe(true);
    expect(canReach(poleOf('mano'), 1, 4)).toBe(false); // todavía va bajando
    expect(canReach(poleOf('colihue-largo'), 1, 4)).toBe(true);
  });

  it('ids desconocidos: bolsa y a mano; están todos en la tienda', () => {
    expect(bagOf(undefined).capacidad).toBe(2);
    expect(poleOf('nada').id).toBe('mano');
    for (const b of BAGS) expect(CATALOG.some((c) => c.key === `bag:${b.id}`)).toBe(true);
  });
});

describe('álbum de trofeos', () => {
  it('convierte el formato viejo (solo el diseño) y limpia el nuevo', () => {
    const old = sanitizeTrophy({ pattern: 'rombos', colors: ['#111111', '#222222', '#333333'], tail: '#444444' });
    expect(old).toMatchObject({ kite: 'mediano', from: '', at: 0, design: { pattern: 'rombos' } });
    const t = trophyOf({ design: old!.design, kite: 'necla', owner: 'b1', ownerName: 'Pancho' }, 1000);
    expect(sanitizeTrophy(t, 5000)).toEqual(t);
    expect(sanitizeTrophy({ ...t, kite: 'no-existe', from: 'x'.repeat(99), at: 9e15 }, 5000)).toMatchObject({ kite: 'mediano', at: 5000 });
    expect(sanitizeTrophy({ ...t, from: 'x'.repeat(99) })!.from).toHaveLength(24);
    expect(sanitizeTrophy('basura')).toBeNull();
    expect(sanitizeTrophy({ kite: 'necla' })).toBeNull();
  });
});

describe('premios de entrega', () => {
  it('el extra por rareza y colihue se paga, pero nunca más de lo posible', () => {
    const p = fresh();
    const r = applyEvents(p, { captures: 2, captureBonus: 30, bestDelivery: 2 }, 30);
    // 2 × 30 + 30 de extra + logros: pescador (40)
    expect(r.coins).toBe(60 + 30 + 40);
    const q = fresh();
    applyEvents(q, { captures: 1, captureBonus: 99999, bestDelivery: 9 }, 30);
    expect(q.stats.captureBonus).toBe(MAX_CAPTURE_BONUS);
    expect(q.stats.bestDelivery).toBe(1);
  });

  it('sin capturas no hay extra ni entrega', () => {
    const p = fresh();
    applyEvents(p, { captures: 0, captureBonus: 50, bestDelivery: 4 }, 30);
    expect(p.stats.captureBonus).toBe(0);
    expect(p.stats.bestDelivery).toBe(0);
  });

  it('entregar 4 de una vez es "Repartidor"', () => {
    const p = fresh();
    applyEvents(p, { captures: 4, bestDelivery: 4 }, 60);
    expect(p.achievements).toContain('repartidor');
  });
});
