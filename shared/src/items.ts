export type Rarity = 'comun' | 'raro' | 'epico' | 'legendario';

export const RARITY_NAMES: Record<Rarity, string> = { comun: 'Común', raro: 'Raro', epico: 'Épico', legendario: 'Legendario' };

export interface LineDef {
  id: string;
  nombre: string;
  filo: number; // ataque: cuánto gasta el hilo rival al cruzarse
  resistencia: number; // vida: cuánto aguanta cruzado y cuánta tensión soporta
  recuperacion: number; // integridad que recupera por segundo sin estar cruzado
  rareza: Rarity;
  nivel: number;
  precio: number;
  color: string;
}

/** Tipos de volantín chilenos: cada uno se dibuja distinto y tiene su carácter. */
export type KiteType = 'cambucha' | 'necla' | 'comision' | 'chonchon' | 'pavo';

export const KITE_TYPES: Record<KiteType, { nombre: string; descripcion: string }> = {
  cambucha: { nombre: 'Cambucha', descripcion: 'De papel y con cola larga: sube fácil y perdona errores, pero es lenta.' },
  necla: { nombre: 'Ñecla', descripcion: 'Chica y rapidísima. Nerviosa en el aire: para atacar.' },
  comision: { nombre: 'Comisión', descripcion: 'El volantín de pelea de siempre: equilibrado.' },
  chonchon: { nombre: 'Chonchón', descripcion: 'Hexagonal y con cola: muy estable, ideal para aguantar cruces.' },
  pavo: { nombre: 'Pavo', descripcion: 'Enorme: tensa mucho el hilo y domina la altura, pero gira lento.' },
};

export interface KiteDef {
  id: string;
  nombre: string;
  tipo: KiteType;
  rareza: Rarity;
  area: number; // m²
  masa: number; // kg
  cl: number;
  cd: number;
  velocidad: number; // cuánto se desplaza de lado al dirigir (1 = normal)
  agilidad: number; // qué tan rápido gira la punta al dirigir y al pegar un tirón
  estabilidad: number; // qué tanto se endereza solo y aguanta el viento sin cabecear
  /** Cola larga: lo estabiliza mientras está entera; un tirón rival la puede cortar. */
  cola: boolean;
  nivel: number;
  precio: number;
}

export interface ReelDef {
  id: string;
  nombre: string;
  maxLine: number; // m
  speed: number; // multiplicador de tirar/soltar
  nivel: number;
  precio: number;
}

/** Tirantes: cómo se amarra el hilo al volantín. Cambian su carácter en el aire. */
export interface BridleDef {
  id: string;
  nombre: string;
  descripcion: string;
  estabilidad: number; // qué tanto endereza la punta hacia arriba
  nervio: number; // cuánto lo mueve el viento solo
  giro: number; // qué tan rápido responde al dirigir
  /** Rango de la perilla de amarre (0 = muy tranquilo, 1 = muy cabeceador) que permiten estos tirantes. */
  amarreMin: number;
  amarreMax: number;
  nivel: number;
  precio: number;
}

export const BRIDLES: BridleDef[] = [
  {
    id: 'tranquilo',
    nombre: 'Tranquilo',
    descripcion: 'Se queda quieto arriba. Fácil de encumbrar, lento para pelear.',
    estabilidad: 3.0,
    nervio: 0.5,
    giro: 2.0,
    amarreMin: 0,
    amarreMax: 0.35,
    nivel: 1,
    precio: 0,
  },
  {
    id: 'normal',
    nombre: 'Normal',
    descripcion: 'Se mece con el viento y responde bien.',
    estabilidad: 1.8,
    nervio: 1.2,
    giro: 3.0,
    amarreMin: 0.2,
    amarreMax: 0.7,
    nivel: 1,
    precio: 0,
  },
  {
    id: 'cabeceador',
    nombre: 'Cabeceador',
    descripcion: 'Se mueve solo de lado a lado y se puede dar vuelta. Gira rápido para cortar.',
    estabilidad: 1.0,
    nervio: 1.8,
    giro: 4.5,
    amarreMin: 0.55,
    amarreMax: 1,
    nivel: 3,
    precio: 250,
  },
  {
    id: 'maestro',
    nombre: 'Tirantes de maestro',
    descripcion: 'Amarre regulable de punta a punta: lo dejas como quieras.',
    estabilidad: 1.8,
    nervio: 1.2,
    giro: 3.0,
    amarreMin: 0,
    amarreMax: 1,
    nivel: 9,
    precio: 2000,
  },
];

/** Carácter de los tirantes en los extremos de la perilla de amarre. */
const AMARRE_0 = { estabilidad: 3.3, nervio: 0.4, giro: 1.8 };
const AMARRE_1 = { estabilidad: 0.9, nervio: 1.95, giro: 4.8 };

/** Posición de la perilla que reproduce cada tirante tal como viene (sin ajustar). */
export function defaultAmarre(b: BridleDef) {
  const a = (AMARRE_0.estabilidad - b.estabilidad) / (AMARRE_0.estabilidad - AMARRE_1.estabilidad);
  return Math.min(b.amarreMax, Math.max(b.amarreMin, a));
}

/**
 * Tirantes con la perilla de amarre aplicada (dentro del rango que permiten).
 * Sin `amarre` quedan tal como vienen.
 */
export function tuneBridle(b: BridleDef, amarre: number | undefined): BridleDef {
  if (amarre === undefined || !Number.isFinite(amarre)) return b;
  const a = Math.min(b.amarreMax, Math.max(b.amarreMin, amarre));
  const mix = (k: keyof typeof AMARRE_0) => AMARRE_0[k] + (AMARRE_1[k] - AMARRE_0[k]) * a;
  return { ...b, estabilidad: mix('estabilidad'), nervio: mix('nervio'), giro: mix('giro') };
}

/** Hilos en cuatro categorías; dentro de cada una hay perfiles agresivos, aguantadores y regeneradores. */
export const LINES: LineDef[] = [
  { id: 'algodon', nombre: 'Hilo de algodón', filo: 1.0, resistencia: 1.0, recuperacion: 2, rareza: 'comun', nivel: 1, precio: 0, color: '#f4f1e8' },
  { id: 'algodon-encerado', nombre: 'Algodón encerado', filo: 1.0, resistencia: 1.12, recuperacion: 2.3, rareza: 'comun', nivel: 2, precio: 120, color: '#efe3c2' },
  { id: 'curado', nombre: 'Hilo curado casero', filo: 1.3, resistencia: 1.2, recuperacion: 2.5, rareza: 'comun', nivel: 3, precio: 300, color: '#e8d9a8' },
  { id: 'curado-vidrio', nombre: 'Curado con vidrio molido', filo: 1.5, resistencia: 1.05, recuperacion: 2.1, rareza: 'raro', nivel: 4, precio: 450, color: '#d9f0e6' },
  { id: 'curado-trenzado', nombre: 'Curado trenzado', filo: 1.2, resistencia: 1.38, recuperacion: 2.4, rareza: 'raro', nivel: 5, precio: 550, color: '#c9a36b' },
  { id: 'curado-cola', nombre: 'Curado con cola de carpintero', filo: 1.25, resistencia: 1.15, recuperacion: 3.3, rareza: 'raro', nivel: 5, precio: 550, color: '#b98c4a' },
  { id: 'fino', nombre: 'Hilo curado fino', filo: 1.6, resistencia: 1.4, recuperacion: 3, rareza: 'raro', nivel: 6, precio: 900, color: '#cfe3f4' },
  { id: 'fino-cortante', nombre: 'Fino cortante', filo: 1.85, resistencia: 1.28, recuperacion: 2.6, rareza: 'epico', nivel: 7, precio: 1200, color: '#9fd3ff' },
  { id: 'fino-encerado', nombre: 'Fino encerado', filo: 1.5, resistencia: 1.62, recuperacion: 3, rareza: 'epico', nivel: 8, precio: 1300, color: '#e2c4f2' },
  { id: 'fino-seda', nombre: 'Fino de seda', filo: 1.5, resistencia: 1.35, recuperacion: 4, rareza: 'epico', nivel: 8, precio: 1300, color: '#ffd1e3' },
  { id: 'campeonato', nombre: 'Hilo de campeonato', filo: 2.0, resistencia: 1.6, recuperacion: 3.5, rareza: 'epico', nivel: 10, precio: 2500, color: '#ffd36b' },
  { id: 'campeonato-navaja', nombre: 'Campeonato navaja', filo: 2.35, resistencia: 1.52, recuperacion: 3.2, rareza: 'legendario', nivel: 12, precio: 3600, color: '#ff9f6b' },
  { id: 'campeonato-roble', nombre: 'Campeonato roble', filo: 1.9, resistencia: 1.95, recuperacion: 3.4, rareza: 'legendario', nivel: 12, precio: 3600, color: '#a7e07a' },
  { id: 'hilo-del-cerro', nombre: 'Hilo del Cerro', filo: 2.2, resistencia: 1.9, recuperacion: 4.2, rareza: 'legendario', nivel: 15, precio: 6000, color: '#7ff0e6' },
];

const base = { cl: 0.9, cd: 0.45 };

/** Volantines: los ids de siempre (cambucha, mediano, grande, gigante) se mantienen para no perder compras. */
export const KITES: KiteDef[] = [
  { id: 'cambucha', nombre: 'Cambucha', tipo: 'cambucha', rareza: 'comun', area: 0.2, masa: 0.08, ...base, velocidad: 0.8, agilidad: 0.8, estabilidad: 1.0, cola: true, nivel: 1, precio: 0 },
  { id: 'mediano', nombre: 'Volantín de comisión', tipo: 'comision', rareza: 'comun', area: 0.4, masa: 0.15, ...base, velocidad: 1, agilidad: 1, estabilidad: 1, cola: false, nivel: 1, precio: 0 },
  { id: 'necla', nombre: 'Ñecla', tipo: 'necla', rareza: 'comun', area: 0.28, masa: 0.09, ...base, velocidad: 1.3, agilidad: 1.35, estabilidad: 0.75, cola: false, nivel: 2, precio: 150 },
  { id: 'chonchon', nombre: 'Chonchón', tipo: 'chonchon', rareza: 'comun', area: 0.45, masa: 0.16, ...base, velocidad: 0.85, agilidad: 0.85, estabilidad: 1.3, cola: true, nivel: 3, precio: 250 },
  { id: 'grande', nombre: 'Comisión grande', tipo: 'comision', rareza: 'raro', area: 0.7, masa: 0.3, ...base, velocidad: 0.95, agilidad: 0.9, estabilidad: 1.1, cola: false, nivel: 5, precio: 700 },
  { id: 'necla-relampago', nombre: 'Ñecla Relámpago', tipo: 'necla', rareza: 'raro', area: 0.3, masa: 0.09, ...base, velocidad: 1.45, agilidad: 1.5, estabilidad: 0.8, cola: false, nivel: 6, precio: 950 },
  { id: 'chonchon-doble', nombre: 'Chonchón Doble', tipo: 'chonchon', rareza: 'raro', area: 0.6, masa: 0.21, ...base, velocidad: 0.9, agilidad: 0.95, estabilidad: 1.45, cola: true, nivel: 7, precio: 1200 },
  { id: 'gigante', nombre: 'Pavo', tipo: 'pavo', rareza: 'raro', area: 1.0, masa: 0.5, ...base, velocidad: 0.75, agilidad: 0.7, estabilidad: 1.3, cola: false, nivel: 8, precio: 1800 },
  { id: 'comision-campeon', nombre: 'Comisión de Campeonato', tipo: 'comision', rareza: 'epico', area: 0.55, masa: 0.2, ...base, velocidad: 1.2, agilidad: 1.2, estabilidad: 1.1, cola: false, nivel: 10, precio: 2800 },
  { id: 'pavo-real', nombre: 'Pavo Real', tipo: 'pavo', rareza: 'epico', area: 1.2, masa: 0.55, ...base, velocidad: 0.85, agilidad: 0.8, estabilidad: 1.5, cola: false, nivel: 12, precio: 3600 },
  { id: 'necla-diablo', nombre: 'Ñecla del Diablo', tipo: 'necla', rareza: 'legendario', area: 0.34, masa: 0.1, ...base, velocidad: 1.6, agilidad: 1.7, estabilidad: 0.85, cola: false, nivel: 14, precio: 5500 },
  { id: 'condor', nombre: 'Cóndor de los Andes', tipo: 'comision', rareza: 'legendario', area: 0.8, masa: 0.28, ...base, velocidad: 1.3, agilidad: 1.25, estabilidad: 1.35, cola: false, nivel: 15, precio: 7000 },
];

export const REELS: ReelDef[] = [
  { id: 'mano', nombre: 'De mano (tarro)', maxLine: 80, speed: 1.0, nivel: 1, precio: 0 },
  { id: 'madera', nombre: 'Carrete de madera', maxLine: 120, speed: 1.2, nivel: 4, precio: 500 },
  { id: 'manivela', nombre: 'Carrete con manivela', maxLine: 160, speed: 1.5, nivel: 7, precio: 1400 },
];

/** Mochila: cuántos volantines capturados puedes llevar antes de ir a dejarlos a tu casa. */
export interface BagDef {
  id: string;
  nombre: string;
  capacidad: number;
  nivel: number;
  precio: number;
}

/** Colihue: alcanza volantines más lejos (y más altos) y hace que paguen más. */
export interface PoleDef {
  id: string;
  nombre: string;
  alcance: number; // m en horizontal
  altura: number; // m sobre el suelo hasta donde alcanza un volantín que va cayendo
  bono: number; // fracción extra que paga cada volantín entregado
  nivel: number;
  precio: number;
}

export const BAGS: BagDef[] = [
  { id: 'bolsa', nombre: 'Bolsa de feria', capacidad: 2, nivel: 1, precio: 0 },
  { id: 'morral', nombre: 'Morral', capacidad: 4, nivel: 3, precio: 300 },
  { id: 'mochila', nombre: 'Mochila escolar', capacidad: 6, nivel: 6, precio: 900 },
  { id: 'trekking', nombre: 'Mochila de trekking', capacidad: 8, nivel: 9, precio: 1800 },
  { id: 'saco', nombre: 'Saco harinero', capacidad: 10, nivel: 12, precio: 3000 },
];

export const POLES: PoleDef[] = [
  { id: 'mano', nombre: 'A mano', alcance: 2.4, altura: 2.5, bono: 0, nivel: 1, precio: 0 },
  { id: 'rama', nombre: 'Rama de sauce', alcance: 3.2, altura: 3.5, bono: 0.1, nivel: 2, precio: 200 },
  { id: 'colihue-corto', nombre: 'Colihue corto', alcance: 4, altura: 5, bono: 0.2, nivel: 5, precio: 700 },
  { id: 'colihue-largo', nombre: 'Colihue largo', alcance: 5, altura: 6.5, bono: 0.35, nivel: 8, precio: 1600 },
  { id: 'colihue-campeon', nombre: 'Colihue de campeón', alcance: 6, altura: 8, bono: 0.5, nivel: 11, precio: 3000 },
];

export const RARITY_VALUE: Record<Rarity, number> = { comun: 1, raro: 1.5, epico: 2, legendario: 3 };

export const byId = <T extends { id: string }>(list: T[], id: string): T => {
  const found = list.find((i) => i.id === id);
  if (!found) throw new Error(`Item desconocido: ${id}`);
  return found;
};
