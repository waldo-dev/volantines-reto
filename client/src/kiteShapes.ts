import type { KiteType } from '@volantines/shared';

/**
 * Contorno de cada tipo de volantín en coordenadas unitarias (x a la derecha, y hacia arriba, dentro de [-1, 1]).
 * La textura del diseño se estira sobre el cuadrado [-1, 1]², así que un mismo diseño sirve para todas las formas.
 */
export interface KiteShape {
  pts: [number, number][];
  /** Varillas: cruz (vertical + colihue arqueado), estrella (tres varillas) o ninguna (papel solo). */
  sticks: 'cross' | 'star' | 'none';
  /** Altura (y) del colihue horizontal en la cruz. */
  bowY: number;
}

const HEX: [number, number][] = [
  [0, 1],
  [0.87, 0.5],
  [0.87, -0.5],
  [0, -1],
  [-0.87, -0.5],
  [-0.87, 0.5],
];

export const KITE_SHAPES: Record<KiteType, KiteShape> = {
  comision: { pts: [[0, 1], [1, 0], [0, -1], [-1, 0]], sticks: 'cross', bowY: 0 },
  pavo: { pts: [[0, 1], [1, 0.08], [0, -1], [-1, 0.08]], sticks: 'cross', bowY: 0.08 },
  necla: { pts: [[0, 1], [0.7, 0.18], [0, -1], [-0.7, 0.18]], sticks: 'cross', bowY: 0.18 },
  chonchon: { pts: HEX, sticks: 'star', bowY: 0 },
  cambucha: { pts: [[-0.8, 0.8], [0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]], sticks: 'none', bowY: 0 },
};

/** Área del contorno unitario (fórmula del zapato). */
export function shapeArea(s: KiteShape) {
  let a = 0;
  for (let i = 0; i < s.pts.length; i++) {
    const [x1, y1] = s.pts[i];
    const [x2, y2] = s.pts[(i + 1) % s.pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Punto más bajo del contorno (de ahí cuelga la cola). */
export const shapeBottom = (s: KiteShape) => Math.min(...s.pts.map((p) => p[1]));
