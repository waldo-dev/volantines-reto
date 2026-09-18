import { SPECIAL_DESIGNS } from './progression';

/** Apariencia del personaje y diseño del volantín: compartidos para que el servidor pueda validarlos. */
export interface Look {
  character: string;
  hat: 'none' | 'jockey' | 'chupalla' | 'gorro';
  hatColor: string;
  glasses: 'none' | 'glasses' | 'sunglasses';
}

export interface KiteDesign {
  /** Id de un patrón dibujado o de un diseño especial (imagen). */
  pattern: string;
  colors: [string, string, string];
  tail: string;
}

export interface Gear {
  kite: string;
  line: string;
  reel: string;
  bridle: string;
}

export const CHARACTERS = [
  { id: 'female-a', nombre: 'Coni' },
  { id: 'female-b', nombre: 'Javi' },
  { id: 'female-c', nombre: 'Fran' },
  { id: 'female-d', nombre: 'Cami' },
  { id: 'female-e', nombre: 'Vale' },
  { id: 'female-f', nombre: 'Anto' },
  { id: 'male-a', nombre: 'Nico' },
  { id: 'male-b', nombre: 'Seba' },
  { id: 'male-c', nombre: 'Mati' },
  { id: 'male-d', nombre: 'Benja' },
  { id: 'male-e', nombre: 'Tomás' },
  { id: 'male-f', nombre: 'Diego' },
] as const;

export const HATS: { id: Look['hat']; nombre: string }[] = [
  { id: 'none', nombre: 'Sin gorro' },
  { id: 'jockey', nombre: 'Jockey' },
  { id: 'chupalla', nombre: 'Chupalla' },
  { id: 'gorro', nombre: 'Gorro de lana' },
];

export const GLASSES: { id: Look['glasses']; nombre: string }[] = [
  { id: 'none', nombre: 'Sin lentes' },
  { id: 'glasses', nombre: 'Lentes' },
  { id: 'sunglasses', nombre: 'Lentes de sol' },
];

export const PATTERNS = [
  { id: 'cuartos', nombre: 'Clásico' },
  { id: 'mitades', nombre: 'Mitades' },
  { id: 'franjas', nombre: 'Franjas' },
  { id: 'estrella', nombre: 'Estrella' },
  { id: 'chile', nombre: 'Bandera' },
  { id: 'ojo', nombre: 'Ojo' },
  { id: 'rombos', nombre: 'Rombos' },
  { id: 'rayos', nombre: 'Rayos' },
] as const;

export const DEFAULT_LOOK: Look = { character: 'male-a', hat: 'jockey', hatColor: '#d52b1e', glasses: 'none' };
export const DEFAULT_DESIGN: KiteDesign = { pattern: 'cuartos', colors: ['#d52b1e', '#ffffff', '#0039a6'], tail: '#d52b1e' };
export const DEFAULT_GEAR: Gear = { kite: 'mediano', line: 'algodon', reel: 'mano', bridle: 'normal' };

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly { id: T }[], fallback: T): T =>
  list.some((i) => i.id === v) ? (v as T) : fallback;

/** Limpia una apariencia que viene de afuera. */
export function sanitizeLook(v: Partial<Look> | undefined): Look {
  return {
    character: oneOf(v?.character, CHARACTERS, DEFAULT_LOOK.character as (typeof CHARACTERS)[number]['id']),
    hat: oneOf(v?.hat, HATS, DEFAULT_LOOK.hat),
    hatColor: hex(v?.hatColor, DEFAULT_LOOK.hatColor),
    glasses: oneOf(v?.glasses, GLASSES, DEFAULT_LOOK.glasses),
  };
}

export const isSpecialDesign = (pattern: string) => SPECIAL_DESIGNS.some((s) => s.id === pattern);

/** Limpia un diseño que viene de afuera (el patrón especial se valida aparte contra lo comprado). */
export function sanitizeDesign(v: Partial<KiteDesign> | undefined): KiteDesign {
  const pattern = typeof v?.pattern === 'string' && (PATTERNS.some((p) => p.id === v.pattern) || isSpecialDesign(v.pattern)) ? v.pattern : DEFAULT_DESIGN.pattern;
  const c = Array.isArray(v?.colors) ? v.colors : [];
  return {
    pattern,
    colors: [hex(c[0], DEFAULT_DESIGN.colors[0]), hex(c[1], DEFAULT_DESIGN.colors[1]), hex(c[2], DEFAULT_DESIGN.colors[2])],
    tail: hex(v?.tail, DEFAULT_DESIGN.tail),
  };
}
