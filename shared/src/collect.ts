import { sanitizeDesign, type KiteDesign } from './cosmetics';
import { BAGS, KITES, POLES, RARITY_VALUE, type KiteDef, type PoleDef } from './items';
import { REWARDS } from './progression';

/** Recoger volantines caídos: mochila, colihue, entrega en tu casa y álbum de trofeos (fase 3). */

export const DEFAULT_BAG = 'bolsa';
export const DEFAULT_POLE = 'mano';
/** Distancia a tu casa a la que se entregan los volantines de la mochila. */
export const DELIVERY_RADIUS = 5;
/** s en que quien perdió un volantín de la mochila no lo puede volver a recoger (los demás sí). */
export const DROP_LOCK = 8;

const pickOr = <T extends { id: string }>(list: T[], id: string | undefined) => list.find((i) => i.id === id) ?? list[0];
export const bagOf = (id: string | undefined) => pickOr(BAGS, id);
export const poleOf = (id: string | undefined) => pickOr(POLES, id);

/** Un volantín en la mochila (y después en el álbum). */
export interface CarryItem {
  design: KiteDesign;
  kite: string; // id del volantín (su tipo y rareza)
  owner: string;
  ownerName: string;
}

/** Monedas que paga un volantín al entregarlo: base × rareza × (1 + bono del colihue). */
export function captureValue(kiteId: string, pole: PoleDef) {
  const def: KiteDef = KITES.find((k) => k.id === kiteId) ?? KITES[1];
  return Math.round(REWARDS.capture * RARITY_VALUE[def.rareza] * (1 + pole.bono));
}

/** ¿Alcanza a capturar un volantín a esta distancia horizontal y altura sobre el suelo? */
export const canReach = (pole: PoleDef, dist: number, height: number) => dist <= pole.alcance && height <= pole.altura;

/** Trofeo del álbum: el volantín que capturaste, de quién era y cuándo lo entregaste. */
export interface Trophy {
  design: KiteDesign;
  kite: string;
  from: string;
  at: number; // ms
}

export const MAX_TROPHIES = 30;

/**
 * Limpia un trofeo que viene de afuera. Acepta el formato viejo (solo el diseño del volantín).
 * Devuelve null si no sirve.
 */
export function sanitizeTrophy(v: unknown, now = Date.now()): Trophy | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if ('pattern' in o) return { design: sanitizeDesign(o as Partial<KiteDesign>), kite: 'mediano', from: '', at: 0 };
  if (!o.design || typeof o.design !== 'object') return null;
  const kite = typeof o.kite === 'string' && KITES.some((k) => k.id === o.kite) ? o.kite : 'mediano';
  const from = typeof o.from === 'string' ? o.from.slice(0, 24) : '';
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? Math.min(now, Math.max(0, Math.floor(o.at))) : now;
  return { design: sanitizeDesign(o.design as Partial<KiteDesign>), kite, from, at };
}

export const trophyOf = (item: CarryItem, at = Date.now()): Trophy => ({ design: item.design, kite: item.kite, from: item.ownerName, at });
