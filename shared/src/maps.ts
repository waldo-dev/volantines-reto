/**
 * Escenarios (fase 4). Cada uno tiene su terreno, su viento, obstáculos (cables del tendido eléctrico)
 * y a veces una zona de bono en el cielo. Todos tienen el lugar para encumbrar en (0, 0) y el viento
 * sopla hacia +x (los volantines vuelan hacia +x).
 *
 * Hay un mapa "activo" que usan `groundHeight` y `windAt`: el cliente juega un mapa a la vez y en el
 * servidor cada sala activa el suyo (`useMap`) antes de simular (Node corre en un solo hilo).
 */

export type MapId = 'cerro' | 'parque' | 'campo' | 'playa' | 'valparaiso';

export interface Hill {
  x: number;
  z: number;
  h: number;
  r: number;
}

/** Cable del tendido: tramo recto entre dos postes, a `h` m sobre el suelo. */
export interface Cable {
  a: [number, number];
  b: [number, number];
  h: number;
}

/** Zona de bono: un cilindro en el cielo; cortar con tu volantín adentro paga extra. */
export interface BonusZone {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

export interface MapDef {
  id: MapId;
  nombre: string;
  emoji: string;
  descripcion: string;
  nivel: number;
  wind: { base: number; variation: number; gust: number; angleVar: number };
  hills: Hill[];
  /** Amplitud de las lomas suaves. */
  rolling: number;
  pond: { x: number; z: number; r: number; level: number } | null;
  /** Mar hacia -x a partir de `x` (la orilla); el agua está a `level`. */
  sea: { x: number; level: number } | null;
  cables: Cable[];
  bonus: BonusZone | null;
}

export const MAPS: MapDef[] = [
  {
    id: 'cerro',
    nombre: 'El Cerro',
    emoji: '⛰️',
    descripcion: 'El de siempre: el cerro, la fonda, la laguna y el pueblo.',
    nivel: 1,
    wind: { base: 5.5, variation: 2, gust: 2.5, angleVar: 0.5 },
    hills: [
      { x: 0, z: 0, h: 8, r: 45 },
      { x: -160, z: 130, h: 16, r: 70 },
      { x: 190, z: 170, h: 11, r: 60 },
      { x: -210, z: -150, h: 13, r: 65 },
    ],
    rolling: 1,
    pond: { x: 95, z: -75, r: 26, level: -1.2 },
    sea: null,
    cables: [],
    bonus: null,
  },
  {
    id: 'parque',
    nombre: "Parque O'Higgins",
    emoji: '🎉',
    descripcion: 'Fiestas Patrias: fondas, ramadas y una zona de bono en el cielo donde se juntan todos a pelear.',
    nivel: 1,
    wind: { base: 5, variation: 1.5, gust: 1.5, angleVar: 0.4 },
    hills: [{ x: 0, z: 0, h: 1.5, r: 40 }],
    rolling: 0.25,
    pond: { x: -70, z: 80, r: 22, level: -1 },
    sea: null,
    cables: [],
    bonus: { x: 48, z: 0, r: 16, y0: 22, y1: 60 },
  },
  {
    id: 'campo',
    nombre: 'Campo al atardecer',
    emoji: '🌅',
    descripcion: 'Viento suave y parejo entre potreros y álamos. Técnica pura.',
    nivel: 2,
    wind: { base: 4.6, variation: 1.1, gust: 1, angleVar: 0.3 },
    hills: [
      { x: 0, z: 0, h: 5, r: 50 },
      { x: 150, z: -120, h: 10, r: 80 },
      { x: -140, z: 160, h: 12, r: 90 },
    ],
    rolling: 1.6,
    pond: null,
    sea: null,
    cables: [],
    bonus: null,
  },
  {
    id: 'playa',
    nombre: 'La Playa',
    emoji: '🏖️',
    descripcion: 'Viento fuerte y constante desde el mar: se sube altísimo. Ojo con el hilo débil.',
    nivel: 4,
    wind: { base: 7.3, variation: 0.9, gust: 1, angleVar: 0.2 },
    hills: [
      { x: 0, z: 0, h: 2, r: 30 },
      { x: 170, z: 0, h: 14, r: 70 },
    ],
    rolling: 0.35,
    pond: null,
    sea: { x: -45, level: -1.2 },
    cables: [],
    bonus: { x: 60, z: 10, r: 18, y0: 35, y1: 80 },
  },
  {
    id: 'valparaiso',
    nombre: 'Cerros de Valparaíso',
    emoji: '⚓',
    descripcion: 'Rachas fuertes entre los cerros y cables del tendido que enredan y cortan el hilo.',
    nivel: 6,
    wind: { base: 6.8, variation: 2.8, gust: 3.8, angleVar: 0.7 },
    hills: [
      { x: 0, z: 0, h: 14, r: 38 },
      { x: 80, z: -90, h: 30, r: 55 },
      { x: 110, z: 95, h: 34, r: 60 },
      { x: 210, z: 0, h: 40, r: 70 },
      { x: -40, z: 140, h: 22, r: 50 },
    ],
    rolling: 1.4,
    pond: null,
    sea: { x: -70, level: -1.2 },
    cables: [
      { a: [-10, -30], b: [140, -34], h: 10 },
      { a: [-10, 32], b: [140, 30], h: 10 },
      { a: [75, -70], b: [75, 70], h: 11 },
    ],
    bonus: null,
  },
];

export const mapById = (id: string | undefined): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0];
export const isMapId = (id: unknown): id is MapId => typeof id === 'string' && MAPS.some((m) => m.id === id);

let active: MapDef = MAPS[0];
const listeners: ((m: MapDef) => void)[] = [];

export const activeMap = () => active;

/** Activa un mapa: desde ahí `groundHeight` y `windAt` usan su terreno y su viento. */
export function useMap(id: MapId | string) {
  const m = mapById(id);
  if (m === active) return m;
  active = m;
  for (const l of listeners) l(m);
  return m;
}

/** Avisa cuando cambia el mapa activo (lo usa el viento para cargar sus parámetros). */
export function onMapChange(fn: (m: MapDef) => void) {
  listeners.push(fn);
}

/** Tramos (entre postes) de los cables del mapa, a su altura real sobre el terreno. */
export function cableSegments(m: MapDef, ground: (x: number, z: number) => number, spacing = 38) {
  const out: { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }[] = [];
  for (const c of m.cables) {
    const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const x0 = c.a[0] + (c.b[0] - c.a[0]) * t0;
      const z0 = c.a[1] + (c.b[1] - c.a[1]) * t0;
      const x1 = c.a[0] + (c.b[0] - c.a[0]) * t1;
      const z1 = c.a[1] + (c.b[1] - c.a[1]) * t1;
      out.push({ a: { x: x0, y: ground(x0, z0) + c.h, z: z0 }, b: { x: x1, y: ground(x1, z1) + c.h, z: z1 } });
    }
  }
  return out;
}

/** ¿Está este punto dentro de la zona de bono del mapa? */
export function inBonus(m: MapDef, p: { x: number; y: number; z: number }) {
  const b = m.bonus;
  return !!b && Math.hypot(p.x - b.x, p.z - b.z) <= b.r && p.y >= b.y0 && p.y <= b.y1;
}
