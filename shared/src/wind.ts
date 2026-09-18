import type { V3 } from './vec';

/** Parámetros del viento; mutables para el panel de debug. */
export const WIND = {
  base: 5.5, // m/s
  variation: 2.0,
  gust: 2.5,
  baseAngle: 0, // rad, hacia dónde sopla en el plano xz
  angleVar: 0.5, // ±~30°
};

export interface WindSample extends V3 {
  speed: number;
  angle: number;
}

/** Viento determinista a partir del tiempo, para que servidor y cliente coincidan. */
export function windAt(t: number, heightAboveGround: number): WindSample {
  const n = Math.sin(t * 0.13) + 0.5 * Math.sin(t * 0.31 + 1.7) + 0.25 * Math.sin(t * 0.71 + 4.1);
  const gust = Math.pow(Math.max(0, Math.sin(t * 0.23 + 2.0) * Math.sin(t * 0.57)), 3);
  const speed = Math.max(0.5, WIND.base + (WIND.variation * n) / 1.75 + WIND.gust * gust);
  const angle = WIND.baseAngle + WIND.angleVar * (0.7 * Math.sin(t * 0.05 + 0.3) + 0.3 * Math.sin(t * 0.17 + 2.2));
  const heightFactor = 0.7 + 0.3 * Math.min(1, Math.max(0, heightAboveGround) / 25);
  const s = speed * heightFactor;
  return { x: Math.cos(angle) * s, y: 0, z: Math.sin(angle) * s, speed, angle };
}
