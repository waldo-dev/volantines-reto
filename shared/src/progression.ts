import { BRIDLES, KITES, LINES, REELS } from './items';

/** Recompensas en monedas; la XP es el doble de las monedas ganadas (ver spec). */
export const REWARDS = {
  flightPer10s: 1,
  cut: 25,
  capture: 30,
};

export interface Stats {
  flightSeconds: number;
  cuts: number;
  captures: number;
  cutBy: number;
  bestAltitude: number;
  longestFlight: number;
  stows: number;
  fullLine: number;
}

export const EMPTY_STATS: Stats = {
  flightSeconds: 0,
  cuts: 0,
  captures: 0,
  cutBy: 0,
  bestAltitude: 0,
  longestFlight: 0,
  stows: 0,
  fullLine: 0,
};

/** Lo que el cliente informa que pasó desde el último reporte. */
export type GameEvents = Stats;

export interface AchievementDef {
  id: string;
  nombre: string;
  descripcion: string;
  monedas: number;
  done: (s: Stats) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'primer-encumbre', nombre: 'Primer encumbre', descripcion: 'Sube tu volantín a 20 m', monedas: 20, done: (s) => s.bestAltitude >= 20 },
  { id: 'a-las-nubes', nombre: 'A las nubes', descripcion: 'Llega a 60 m de altura', monedas: 60, done: (s) => s.bestAltitude >= 60 },
  { id: 'todo-el-hilo', nombre: 'Todo el hilo', descripcion: 'Suelta todo el hilo del carrete', monedas: 30, done: (s) => s.fullLine >= 1 },
  { id: 'a-la-casa', nombre: 'A la casa', descripcion: 'Recoge el volantín hasta guardarlo', monedas: 20, done: (s) => s.stows >= 1 },
  { id: 'aguante', nombre: 'Aguante', descripcion: 'Vuela 5 minutos sin caerte ni cortarte', monedas: 80, done: (s) => s.longestFlight >= 300 },
  { id: 'comision', nombre: '¡Comisión!', descripcion: 'Corta tu primer volantín', monedas: 50, done: (s) => s.cuts >= 1 },
  { id: 'cortador', nombre: 'Cortador', descripcion: 'Corta 10 volantines', monedas: 150, done: (s) => s.cuts >= 10 },
  { id: 'pescador', nombre: 'Pescador', descripcion: 'Captura un volantín caído', monedas: 40, done: (s) => s.captures >= 1 },
  { id: 'coleccionista', nombre: 'Coleccionista', descripcion: 'Captura 10 volantines', monedas: 150, done: (s) => s.captures >= 10 },
  { id: 'veterano', nombre: 'Veterano', descripcion: 'Vuela 1 hora en total', monedas: 200, done: (s) => s.flightSeconds >= 3600 },
];

/** Diseños especiales ilustrados que se compran con monedas. */
export const SPECIAL_DESIGNS = [
  { id: 'kite-copihue', nombre: 'Copihue', nivel: 2, precio: 150 },
  { id: 'kite-condor', nombre: 'Cóndor', nivel: 3, precio: 200 },
  { id: 'kite-sol', nombre: 'Sol', nivel: 2, precio: 150 },
  { id: 'kite-mosaico', nombre: 'Mosaico', nivel: 1, precio: 100 },
  { id: 'kite-cara', nombre: 'Carita', nivel: 1, precio: 100 },
  { id: 'kite-fuego', nombre: 'Fuego', nivel: 4, precio: 250 },
];

export type ItemKind = 'kite' | 'line' | 'reel' | 'bridle' | 'design';

export interface CatalogItem {
  key: string; // "kind:id"
  kind: ItemKind;
  id: string;
  nombre: string;
  nivel: number;
  precio: number;
}

export const CATALOG: CatalogItem[] = [
  ...KITES.map((i) => ({ key: `kite:${i.id}`, kind: 'kite' as const, id: i.id, nombre: i.nombre, nivel: i.nivel, precio: i.precio })),
  ...LINES.map((i) => ({ key: `line:${i.id}`, kind: 'line' as const, id: i.id, nombre: i.nombre, nivel: i.nivel, precio: i.precio })),
  ...REELS.map((i) => ({ key: `reel:${i.id}`, kind: 'reel' as const, id: i.id, nombre: i.nombre, nivel: i.nivel, precio: i.precio })),
  ...BRIDLES.map((i) => ({ key: `bridle:${i.id}`, kind: 'bridle' as const, id: i.id, nombre: i.nombre, nivel: i.nivel, precio: i.precio })),
  ...SPECIAL_DESIGNS.map((i) => ({ key: `design:${i.id}`, kind: 'design' as const, id: i.id, nombre: i.nombre, nivel: i.nivel, precio: i.precio })),
];

export const catalogItem = (key: string) => CATALOG.find((c) => c.key === key);

/** Lo gratis de nivel 1 lo tiene todo el mundo desde el principio. */
export const isStarter = (item: CatalogItem) => item.precio === 0 && item.nivel <= 1;

export interface Progress {
  xp: number;
  coins: number;
  stats: Stats;
  achievements: string[];
  owned: string[];
}

/** Nivel según XP: pasar del nivel N al N+1 cuesta 100 × N de XP. */
export function levelInfo(xp: number) {
  let level = 1;
  let rest = xp;
  while (rest >= 100 * level) {
    rest -= 100 * level;
    level++;
  }
  return { level, into: rest, need: 100 * level };
}

export function owns(p: Progress, key: string) {
  const item = catalogItem(key);
  return !!item && (isStarter(item) || p.owned.includes(key));
}

/** Devuelve el motivo si no se puede comprar, o null si se puede. */
export function buyError(p: Progress, key: string): string | null {
  const item = catalogItem(key);
  if (!item) return 'Ese objeto no existe.';
  if (owns(p, key)) return 'Ya lo tienes.';
  if (levelInfo(p.xp).level < item.nivel) return `Necesitas nivel ${item.nivel}.`;
  if (p.coins < item.precio) return `Te faltan ${item.precio - p.coins} monedas.`;
  return null;
}

/**
 * Suma un reporte de juego al progreso: monedas, XP, estadísticas y logros nuevos.
 * `elapsed` son los segundos reales desde el último reporte; sirve para acotar reportes inflados.
 */
export function applyEvents(p: Progress, raw: Partial<GameEvents>, elapsed: number) {
  const cap = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const e: GameEvents = {
    flightSeconds: cap(raw.flightSeconds, elapsed + 5),
    cuts: cap(raw.cuts, Math.ceil(elapsed / 3)),
    captures: cap(raw.captures, Math.ceil(elapsed / 4)),
    cutBy: cap(raw.cutBy, Math.ceil(elapsed / 3)),
    bestAltitude: cap(raw.bestAltitude, 200),
    longestFlight: cap(raw.longestFlight, p.stats.longestFlight + elapsed + 5),
    stows: cap(raw.stows, Math.ceil(elapsed / 3)),
    fullLine: cap(raw.fullLine, Math.ceil(elapsed / 3)),
  };
  const s = p.stats;
  const flightBefore = s.flightSeconds;
  s.flightSeconds += e.flightSeconds;
  s.cuts += e.cuts;
  s.captures += e.captures;
  s.cutBy += e.cutBy;
  s.stows += e.stows;
  s.fullLine += e.fullLine;
  s.bestAltitude = Math.max(s.bestAltitude, e.bestAltitude);
  s.longestFlight = Math.max(s.longestFlight, e.longestFlight);

  // Por tiempo de vuelo se paga cada 10 s acumulados, sin perder los restos entre reportes
  const flightCoins = (Math.floor(s.flightSeconds / 10) - Math.floor(flightBefore / 10)) * REWARDS.flightPer10s;
  let coins = flightCoins + e.cuts * REWARDS.cut + e.captures * REWARDS.capture;
  const unlocked: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!p.achievements.includes(a.id) && a.done(s)) {
      p.achievements.push(a.id);
      unlocked.push(a);
      coins += a.monedas;
    }
  }
  const levelBefore = levelInfo(p.xp).level;
  p.coins += coins;
  p.xp += coins * 2;
  const levelAfter = levelInfo(p.xp).level;
  return { coins, xp: coins * 2, unlocked, levelUp: levelAfter > levelBefore ? levelAfter : null };
}
