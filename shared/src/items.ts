export interface LineDef {
  id: string;
  nombre: string;
  filo: number;
  resistencia: number;
  nivel: number;
  precio: number;
  color: string;
}

export interface KiteDef {
  id: string;
  nombre: string;
  area: number; // m²
  masa: number; // kg
  cl: number;
  cd: number;
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
    nivel: 3,
    precio: 250,
  },
];

export const LINES: LineDef[] = [
  { id: 'algodon', nombre: 'Hilo de algodón', filo: 1.0, resistencia: 1.0, nivel: 1, precio: 0, color: '#f4f1e8' },
  { id: 'curado', nombre: 'Hilo curado casero', filo: 1.3, resistencia: 1.2, nivel: 3, precio: 300, color: '#e8d9a8' },
  { id: 'fino', nombre: 'Hilo curado fino', filo: 1.6, resistencia: 1.4, nivel: 6, precio: 900, color: '#cfe3f4' },
  { id: 'campeonato', nombre: 'Hilo de campeonato', filo: 2.0, resistencia: 1.6, nivel: 10, precio: 2500, color: '#ffd36b' },
];

export const KITES: KiteDef[] = [
  { id: 'cambucha', nombre: 'Cambucha', area: 0.2, masa: 0.08, cl: 0.9, cd: 0.45, nivel: 1, precio: 0 },
  { id: 'mediano', nombre: 'Volantín mediano', area: 0.4, masa: 0.15, cl: 0.9, cd: 0.45, nivel: 1, precio: 0 },
  { id: 'grande', nombre: 'Volantín grande', area: 0.7, masa: 0.3, cl: 0.9, cd: 0.45, nivel: 5, precio: 700 },
  { id: 'gigante', nombre: 'Volantín gigante', area: 1.0, masa: 0.5, cl: 0.9, cd: 0.45, nivel: 8, precio: 1800 },
];

export const REELS: ReelDef[] = [
  { id: 'mano', nombre: 'De mano (tarro)', maxLine: 80, speed: 1.0, nivel: 1, precio: 0 },
  { id: 'madera', nombre: 'Carrete de madera', maxLine: 120, speed: 1.2, nivel: 4, precio: 500 },
  { id: 'manivela', nombre: 'Carrete con manivela', maxLine: 160, speed: 1.5, nivel: 7, precio: 1400 },
];

export const byId = <T extends { id: string }>(list: T[], id: string): T => {
  const found = list.find((i) => i.id === id);
  if (!found) throw new Error(`Item desconocido: ${id}`);
  return found;
};
