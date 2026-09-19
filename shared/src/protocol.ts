import type { Gear, KiteDesign, Look } from './cosmetics';
import type { CarryItem } from './collect';
import type { KiteState, ManeuverKind } from './kite';
import type { MapId } from './maps';

/** Mensajes del modo online (WebSocket en /ws). Números redondeados para que los paquetes sean chicos. */

export const MAX_PLAYERS = 8;
export const NET_RATE = 20; // estados y snapshots por segundo

type N3 = [number, number, number];

/** Volantín comprimido para la red. */
export interface NetKite {
  p: N3;
  v: N3;
  h: number; // heading
  a: number; // aoa
  L: number; // largo de hilo
  r: number; // velocidad del carrete
  T: number; // tensión 0..1
  w: number; // desgaste
  g: 0 | 1; // en el suelo
  s: 0 | 1; // guardado
  m?: ManeuverKind; // última maniobra (si fue hace poco)
  ma?: number; // hace cuánto empezó (s)
  tc?: 1; // le cortaron la cola
}

/** Estado de un jugador para la red. `fid` cambia con cada volantín nuevo que encumbra. */
export interface NetState {
  p: N3;
  v: [number, number];
  f: number; // hacia dónde mira
  fid: number;
  k?: NetKite;
  rope?: number[]; // puntos del hilo aplanados (x, y, z, ...)
}

export interface NetPlayerInfo {
  id: string;
  name: string;
  look: Look;
  design: KiteDesign;
  gear: Gear;
  bot: boolean;
}

export interface NetFallen {
  id: string;
  p: N3;
  h: number;
  g: 0 | 1;
}

/** Un jugador en el snapshot: estado, integridad del hilo, con quién está cruzado y si va en racha. */
export interface NetSnapPlayer {
  id: string;
  s: NetState;
  I: number;
  x: string | null;
  b?: 1;
}

export type ClientMsg =
  /** `map`: el mapa que quiere (para partida rápida o sala nueva); con código manda el de la sala. */
  | { t: 'join'; room: string; name: string; look: Look; design: KiteDesign; gear: Gear; token?: string | null; map?: MapId }
  | { t: 'state'; s: NetState }
  | { t: 'broken' } // mi hilo se cortó solo (desgaste)
  | { t: 'profile'; name: string; look: Look; design: KiteDesign; gear: Gear };

export type ServerMsg =
  | { t: 'welcome'; id: string; room: string; private: boolean; time: number; spawn: N3; info: NetPlayerInfo[]; map: MapId }
  | { t: 'info'; info: NetPlayerInfo[] }
  | { t: 'snap'; time: number; players: NetSnapPlayer[]; fallen: NetFallen[] }
  /**
   * combo: largo del combo del que cortó; upset: cortó con peor hilo; streak: con este corte entró en racha;
   * bonus: cortó dentro de la zona de bono; cable: se cortó en los cables.
   */
  | { t: 'cut'; victim: string; cutter: string | null; combo?: number; upset?: 1; streak?: 1; bonus?: 1; cable?: 1 }
  | { t: 'crit'; by: string; victim: string; kind: ManeuverKind; p: N3 }
  | { t: 'tail'; by: string; victim: string; p: N3 }
  /** Alguien llegó a su casa con volantines en la mochila. */
  | { t: 'delivered'; by: string; items: CarryItem[] }
  /** El servidor acreditó premios a tu cuenta (online): tu jugador actualizado y lo que ganaste. */
  | { t: 'rewards'; player: Record<string, unknown>; rewards: unknown }
  | { t: 'fallen'; id: string; owner: string; ownerName: string; design: KiteDesign; kite: string; p: N3; h: number }
  | { t: 'captured'; fallen: string; by: string }
  | { t: 'error'; msg: string };

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Una maniobra se manda mientras todavía puede contar para un golpe crítico. */
const MANEUVER_TTL = 1;

export function encodeKite(k: KiteState): NetKite {
  const recent = k.maneuver !== 0 && k.maneuverAge < MANEUVER_TTL;
  return {
    ...(recent ? { m: k.maneuver, ma: r2(k.maneuverAge) } : {}),
    ...(k.tailCut ? { tc: 1 as const } : {}),
    p: [r2(k.pos.x), r2(k.pos.y), r2(k.pos.z)],
    v: [r2(k.vel.x), r2(k.vel.y), r2(k.vel.z)],
    h: r3(k.heading),
    a: r2(k.aoa),
    L: r2(k.lineLength),
    r: r2(k.lineRate),
    T: r2(k.tension),
    w: r2(k.wear),
    g: k.grounded ? 1 : 0,
    s: k.stowed ? 1 : 0,
  };
}

/** Copia un volantín de la red sobre un KiteState existente. */
export function applyNetKite(k: KiteState, n: NetKite) {
  k.pos.x = n.p[0];
  k.pos.y = n.p[1];
  k.pos.z = n.p[2];
  k.vel.x = n.v[0];
  k.vel.y = n.v[1];
  k.vel.z = n.v[2];
  k.heading = n.h;
  k.aoa = n.a;
  k.lineLength = n.L;
  k.lineRate = n.r;
  k.tension = n.T;
  k.wear = n.w;
  k.grounded = n.g === 1;
  k.stowed = n.s === 1;
  k.maneuver = n.m ?? 0;
  k.maneuverAge = n.ma ?? 99;
  k.tailCut = n.tc === 1;
}

/** Aplana el hilo para la red con a lo más `maxPoints` puntos (siempre incluye mano y volantín). */
export function encodeRope(pts: { x: number; y: number; z: number }[], maxPoints = 10): number[] {
  const out: number[] = [];
  const n = Math.min(maxPoints, pts.length);
  for (let i = 0; i < n; i++) {
    const p = pts[Math.round((i / (n - 1)) * (pts.length - 1))];
    out.push(r2(p.x), r2(p.y), r2(p.z));
  }
  return out;
}

/** Copia un hilo aplanado sobre `pts`, re-muestreando si la cantidad de puntos no coincide. */
export function decodeRope(flat: number[], pts: { x: number; y: number; z: number }[]) {
  const n = flat.length / 3;
  if (n < 2) return;
  for (let i = 0; i < pts.length; i++) {
    const t = (i / (pts.length - 1)) * (n - 1);
    const a = Math.floor(t);
    const b = Math.min(n - 1, a + 1);
    const f = t - a;
    pts[i].x = flat[a * 3] + (flat[b * 3] - flat[a * 3]) * f;
    pts[i].y = flat[a * 3 + 1] + (flat[b * 3 + 1] - flat[a * 3 + 1]) * f;
    pts[i].z = flat[a * 3 + 2] + (flat[b * 3 + 2] - flat[a * 3 + 2]) * f;
  }
}

/** Códigos de sala: 5 letras sin las que se confunden (I, O, L...). */
export function roomCode(rand: () => number = Math.random) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(rand() * abc.length)];
  return s;
}
