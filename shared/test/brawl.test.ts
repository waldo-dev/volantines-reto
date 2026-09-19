import { describe, expect, it } from 'vitest';
import { BRAWL, RevengeBook, brawlTarget, knockDir } from '../src/brawl';

const at = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z } });

describe('charchazos', () => {
  // Mira hacia +z (facing 0)
  const me = { id: 'yo', pos: { x: 0, y: 0, z: 0 }, facing: 0 };
  const all = () => true;

  it('le llega al que está al frente y dentro del alcance, al más cercano', () => {
    expect(brawlTarget(me, [at('lejos', 0, 1.8), at('cerca', 0.3, 1.2)], all)?.id).toBe('cerca');
    expect(brawlTarget(me, [at('fuera', 0, BRAWL.range + 0.2)], all)).toBeNull();
  });

  it('no le llega al que está a la espalda, salvo que esté muy pegado', () => {
    expect(brawlTarget(me, [at('atras', 0, -1.5)], all)).toBeNull();
    expect(brawlTarget(me, [at('pegado', 0, -0.6)], all)?.id).toBe('pegado');
  });

  it('respeta la protección y no se pega a sí mismo', () => {
    expect(brawlTarget(me, [at('yo', 0, 1), at('protegido', 0, 1)], (o) => o.id !== 'protegido')).toBeNull();
  });

  it('el empujón va del que pega al que recibe', () => {
    const d = knockDir({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 });
    expect(d.x).toBeCloseTo(0.6);
    expect(d.z).toBeCloseTo(0.8);
  });

  it('venganza: solo contra quien te cortó, dentro del plazo y una sola vez', () => {
    const book = new RevengeBook();
    book.cut('ana', 'beto', 10);
    expect(book.take('ana', 'coni', 12)).toBe(false);
    expect(book.take('ana', 'beto', 12)).toBe(true);
    expect(book.take('ana', 'beto', 13)).toBe(false);
    book.cut('ana', 'beto', 20);
    expect(book.take('ana', 'beto', 20 + BRAWL.revengeWindow + 1)).toBe(false);
  });
});
