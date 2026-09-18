import { activeMap } from './maps';

const bump = (x: number, z: number, cx: number, cz: number, h: number, r: number) => {
  const dx = x - cx;
  const dz = z - cz;
  return h * Math.exp(-(dx * dx + dz * dz) / (2 * r * r));
};

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Altura del terreno en (x, z) según el mapa activo: cerros, lomas, laguna y mar. */
export function groundHeight(x: number, z: number): number {
  const m = activeMap();
  let h = 0;
  for (const hill of m.hills) h += bump(x, z, hill.x, hill.z, hill.h, hill.r);
  if (m.pond) h += bump(x, z, m.pond.x, m.pond.z, -4.5, m.pond.r * 0.75);
  const rolling = 1.2 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 0.6 * Math.sin(x * 0.13 + z * 0.09);
  // Aplana lejos del centro para que el horizonte se vea limpio
  const far = Math.min(1, Math.hypot(x, z) / 320);
  h += rolling * m.rolling * (1 - far);
  if (m.sea) {
    // Playa que baja suave hacia el mar (hacia -x desde la orilla)
    const t = smooth((m.sea.x + 12 - x) / 40);
    h = h * (1 - t) + (m.sea.level - 3) * t;
  }
  return h;
}

/** Laguna del mapa activo (o null). */
export const pondOf = () => activeMap().pond;

/** ¿Se puede caminar ahí? No dentro del mar ni de la laguna. */
export function walkable(x: number, z: number) {
  const m = activeMap();
  if (m.pond && Math.hypot(x - m.pond.x, z - m.pond.z) < m.pond.r - 2) return false;
  if (m.sea && groundHeight(x, z) < m.sea.level + 0.1) return false;
  return true;
}
