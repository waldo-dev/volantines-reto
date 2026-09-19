import type { ClientMsg, Gear, KiteDesign, Look, MapId, NetFallen, NetPlayerInfo, NetSnapPlayer, NetState, ServerMsg } from '@volantines/shared';

/** Se dibuja a los demás un poco en el pasado para poder interpolar entre dos snapshots. */
const INTERP_DELAY = 0.12;
const BUFFER = 12;

interface Snap {
  time: number;
  players: Map<string, NetSnapPlayer>;
}

export interface JoinProfile {
  name: string;
  look: Look;
  design: KiteDesign;
  gear: Gear;
  token: string | null;
  /** Mapa que quieres (partida rápida o sala nueva). */
  map: MapId;
}

export type NetEvent =
  | { t: 'info'; info: NetPlayerInfo[] }
  | Extract<ServerMsg, { t: 'cut' }>
  | Extract<ServerMsg, { t: 'crit' }>
  | Extract<ServerMsg, { t: 'tail' }>
  | Extract<ServerMsg, { t: 'delivered' }>
  | Extract<ServerMsg, { t: 'rewards' }>
  | { t: 'fallen'; id: string; owner: string; ownerName: string; design: KiteDesign; kite: string; p: [number, number, number]; h: number }
  | { t: 'captured'; fallen: string; by: string }
  | { t: 'closed'; reason: string };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Conexión a una sala. Los eventos quedan en cola y el juego los procesa en su bucle. */
export class Online {
  myId = '';
  room = '';
  isPrivate = false;
  spawn: [number, number, number] = [0, 0, 0];
  /** Mapa de la sala (lo decide el servidor). */
  map: MapId = 'cerro';
  info = new Map<string, NetPlayerInfo>();
  readonly events: NetEvent[] = [];
  fallen: NetFallen[] = [];
  private ws: WebSocket | null = null;
  private snaps: Snap[] = [];
  private offset: number | null = null;

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN && this.myId !== '';
  }

  /** Entra a una sala: '' = partida rápida, 'NUEVA' = sala privada nueva, o un código. */
  connect(room: string, p: JoinProfile): Promise<void> {
    this.close();
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const fail = (msg: string) => {
        reject(new Error(msg));
        ws.close();
      };
      const timer = setTimeout(() => fail('El servidor no responde.'), 8000);
      ws.onopen = () => this.send({ t: 'join', room, name: p.name, look: p.look, design: p.design, gear: p.gear, token: p.token, map: p.map });
      ws.onerror = () => fail('No se pudo conectar al servidor.');
      ws.onclose = () => {
        if (this.myId) this.events.push({ t: 'closed', reason: 'Se perdió la conexión con la sala.' });
        this.myId = '';
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data as string) as ServerMsg;
        switch (m.t) {
          case 'welcome':
            clearTimeout(timer);
            this.myId = m.id;
            this.room = m.room;
            this.isPrivate = m.private;
            this.spawn = m.spawn;
            this.map = m.map ?? 'cerro';
            this.setInfo(m.info);
            this.syncClock(m.time);
            resolve();
            break;
          case 'error':
            clearTimeout(timer);
            fail(m.msg);
            break;
          case 'info':
            this.setInfo(m.info);
            this.events.push(m);
            break;
          case 'snap':
            this.syncClock(m.time);
            this.snaps.push({ time: m.time, players: new Map(m.players.map((pl) => [pl.id, pl])) });
            if (this.snaps.length > BUFFER) this.snaps.shift();
            this.fallen = m.fallen;
            break;
          default:
            this.events.push(m);
        }
      };
    });
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    this.myId = '';
    this.snaps = [];
    this.info.clear();
    this.offset = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Hora de la sala (segundos), para que el viento sea el mismo para todos. */
  serverNow() {
    return performance.now() / 1000 + (this.offset ?? 0);
  }

  private syncClock(serverTime: number) {
    const estimate = serverTime - performance.now() / 1000;
    // Se suaviza; si se desfasó mucho (pestaña dormida) se corrige de golpe
    if (this.offset === null || Math.abs(estimate - this.offset) > 1) this.offset = estimate;
    else this.offset += (estimate - this.offset) * 0.05;
  }

  private setInfo(info: NetPlayerInfo[]) {
    this.info = new Map(info.map((i) => [i.id, i]));
  }

  /** Lo último que dijo el servidor sobre un jugador (integridad del hilo y con quién está cruzado). */
  latest(id: string) {
    return this.snaps[this.snaps.length - 1]?.players.get(id) ?? null;
  }

  /** Estado interpolado de otro jugador, un poco en el pasado para que se vea fluido. */
  sample(id: string): NetState | null {
    const t = this.serverNow() - INTERP_DELAY;
    let a: Snap | null = null;
    let b: Snap | null = null;
    for (const s of this.snaps) {
      if (s.time <= t) a = s;
      else {
        b = s;
        break;
      }
    }
    const sa = a?.players.get(id)?.s;
    const sb = b?.players.get(id)?.s;
    if (!sa || !sb || !a || !b) return (sb ?? sa ?? this.latest(id)?.s) || null;
    if (sa.fid !== sb.fid || !!sa.k !== !!sb.k) return sb;
    const f = Math.min(1, Math.max(0, (t - a.time) / (b.time - a.time)));
    const out: NetState = {
      p: [lerp(sa.p[0], sb.p[0], f), lerp(sa.p[1], sb.p[1], f), lerp(sa.p[2], sb.p[2], f)],
      v: sb.v,
      f: lerpAngle(sa.f, sb.f, f),
      fid: sb.fid,
    };
    if (sa.k && sb.k) {
      out.k = {
        ...sb.k,
        p: [lerp(sa.k.p[0], sb.k.p[0], f), lerp(sa.k.p[1], sb.k.p[1], f), lerp(sa.k.p[2], sb.k.p[2], f)],
        h: lerpAngle(sa.k.h, sb.k.h, f),
        L: lerp(sa.k.L, sb.k.L, f),
      };
    }
    if (sa.rope && sb.rope && sa.rope.length === sb.rope.length) out.rope = sa.rope.map((v, i) => lerp(v, sb.rope![i], f));
    else out.rope = sb.rope;
    return out;
  }
}
