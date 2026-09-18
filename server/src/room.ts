import {
  BOT_NAMES,
  EMPTY_STATS,
  MAX_PLAYERS,
  NET_RATE,
  Rope,
  applyNetKite,
  createBrain,
  createKite,
  decodeRope,
  encodeKite,
  encodeRope,
  groundHeight,
  owns,
  randomBot,
  resolveCrossings,
  roomCode,
  sanitizeDesign,
  sanitizeLook,
  spawnSlot,
  stepKite,
  updateBotBody,
  windAt,
  type BotBody,
  type BotBrain,
  type BotView,
  type Gear,
  type KiteDesign,
  type KiteState,
  type LineBody,
  type Loadout,
  type Look,
  type NetPlayerInfo,
  type NetState,
  type Progress,
  type ServerMsg,
  type V3,
} from '@volantines/shared';
import { BRIDLES, KITES, LINES, REELS } from '@volantines/shared';
import type { WebSocket } from 'ws';

const TICK = 1 / NET_RATE;
const SUBSTEPS = 6; // física a 120 Hz para bots y volantines caídos
const CAPTURE_RADIUS = 2.4;
const FALLEN_LIFETIME = 90;
const EMPTY_ROOM_TTL = 30_000;
const NO_INPUT = { tirar: false, soltar: false, dirX: 0 };

const pickItem = <T extends { id: string }>(list: T[], id: string) => list.find((i) => i.id === id) ?? list[0];
export const loadoutOf = (g: Gear): Loadout => ({
  kite: pickItem(KITES, g.kite),
  line: pickItem(LINES, g.line),
  reel: pickItem(REELS, g.reel),
  bridle: pickItem(BRIDLES, g.bridle),
});

/** Deja solo el equipo que el jugador tiene (invitados: solo lo inicial). */
export function allowedGear(g: Partial<Gear> | undefined, progress: Progress | null): Gear {
  const p: Progress = progress ?? { xp: 0, coins: 0, stats: { ...EMPTY_STATS }, achievements: [], owned: [] };
  const pick = (kind: keyof Gear, fallback: string) => {
    const id = g?.[kind];
    return typeof id === 'string' && owns(p, `${kind}:${id}`) ? id : fallback;
  };
  return { kite: pick('kite', 'mediano'), line: pick('line', 'algodon'), reel: pick('reel', 'mano'), bridle: pick('bridle', 'normal') };
}

interface Human {
  id: string;
  ws: WebSocket;
  name: string;
  look: Look;
  design: KiteDesign;
  gear: Gear;
  loadout: Loadout;
  progress: Progress | null;
  slot: number;
  state: NetState | null;
  integrity: number;
  /** Volantín (fid) que el servidor ya dio por cortado: se ignora hasta que encumbre otro. */
  deadFid: number;
  scratchKite: KiteState;
  scratchPts: V3[];
}

class Bot implements BotBody {
  pos: V3;
  vel: V3 = { x: 0, y: 0, z: 0 };
  anchor: V3;
  home: V3;
  kite: KiteState | null = null;
  loadout: Loadout;
  brain: BotBrain;
  botState: BotBody['botState'] = 'esperar';
  botTimer = 1 + Math.random() * 3;
  rope = new Rope(16);
  facing = 0;
  fid = 0;
  name: string;
  look: Look;
  design: KiteDesign;
  gear: Gear;

  constructor(
    readonly id: string,
    readonly slot: number,
    index: number,
  ) {
    const b = randomBot(index, Math.random);
    this.name = b.name;
    this.look = b.look;
    this.design = b.design;
    this.gear = b.gear;
    this.loadout = loadoutOf(b.gear);
    this.brain = createBrain(Math.random, b.skill);
    const s = spawnSlot(slot);
    this.pos = { x: s.x, y: groundHeight(s.x, s.z), z: s.z };
    this.home = { ...this.pos };
    this.anchor = { x: this.pos.x, y: this.pos.y + 1.25, z: this.pos.z };
  }

  launch(wind: V3) {
    const l = Math.hypot(wind.x, wind.z) || 1;
    this.kite = createKite(this.anchor, wind.x / l, wind.z / l, Math.random() * 100);
    this.rope.reset(this.anchor, this.kite.pos);
    this.fid++;
  }

  /** La mano: un poco adelante del cuerpo, hacia el volantín. */
  updateAnchor() {
    let dx = 0;
    let dz = 0;
    if (this.kite && !this.kite.stowed) {
      dx = this.kite.pos.x - this.pos.x;
      dz = this.kite.pos.z - this.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      this.facing = Math.atan2(dx, dz);
    }
    this.anchor.x = this.pos.x + dx * 0.3;
    this.anchor.y = this.pos.y + 1.25;
    this.anchor.z = this.pos.z + dz * 0.3;
  }

  get flying() {
    return !!this.kite && !this.kite.broken && !this.kite.stowed;
  }

  netState(): NetState {
    const s: NetState = { p: [this.pos.x, this.pos.y, this.pos.z], v: [this.vel.x, this.vel.z], f: this.facing, fid: this.fid };
    if (this.kite) {
      s.k = encodeKite(this.kite);
      if (!this.kite.stowed) s.rope = encodeRope(this.rope.pts);
    }
    return s;
  }
}

interface Fallen {
  id: string;
  owner: string;
  ownerName: string;
  design: KiteDesign;
  lo: Loadout;
  kite: KiteState;
  groundTime: number;
}

let nextId = 1;
const newId = (prefix: string) => `${prefix}${(nextId++).toString(36)}`;

/** Una sala: hasta 8 personas, bots de relleno, cruces y cortes decididos por el servidor. */
export class Room {
  readonly humans = new Map<string, Human>();
  private bots: Bot[] = [];
  private fallen: Fallen[] = [];
  private hooks = new Set<string>();
  private contacts = new Set<string>();
  private crossingOf = new Map<string, string>();
  time = 0;
  private timer: NodeJS.Timeout;
  private emptySince = Date.now();

  constructor(
    readonly code: string,
    readonly isPrivate: boolean,
    private onEmpty: (room: Room) => void,
  ) {
    this.syncBots();
    this.timer = setInterval(() => this.tick(), TICK * 1000);
  }

  get full() {
    return this.humans.size >= MAX_PLAYERS;
  }

  close() {
    clearInterval(this.timer);
  }

  join(ws: WebSocket, p: { name: string; look: Look; design: KiteDesign; gear: Gear; progress: Progress | null }): Human {
    const used = new Set([...this.humans.values()].map((h) => h.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const h: Human = {
      id: newId('p'),
      ws,
      name: p.name,
      look: sanitizeLook(p.look),
      design: sanitizeDesign(p.design),
      gear: allowedGear(p.gear, p.progress),
      loadout: loadoutOf(allowedGear(p.gear, p.progress)),
      progress: p.progress,
      slot,
      state: null,
      integrity: 100,
      deadFid: -1,
      scratchKite: createKite({ x: 0, y: 0, z: 0 }, 1, 0),
      scratchPts: [],
    };
    this.humans.set(h.id, h);
    this.syncBots();
    const spawn = spawnSlot(slot);
    this.send(h, { t: 'welcome', id: h.id, room: this.code, private: this.isPrivate, time: this.time, spawn: [spawn.x, spawn.y, spawn.z], info: this.info() });
    this.broadcast({ t: 'info', info: this.info() });
    return h;
  }

  leave(h: Human) {
    this.humans.delete(h.id);
    this.syncBots();
    this.broadcast({ t: 'info', info: this.info() });
    if (this.humans.size === 0) this.emptySince = Date.now();
  }

  updateProfile(h: Human, p: { name: string; look: Look; design: KiteDesign; gear: Gear }) {
    h.name = p.name;
    h.look = sanitizeLook(p.look);
    h.design = sanitizeDesign(p.design);
    h.gear = allowedGear(p.gear, h.progress);
    h.loadout = loadoutOf(h.gear);
    this.broadcast({ t: 'info', info: this.info() });
  }

  setState(h: Human, s: NetState) {
    if (s.fid !== h.state?.fid) h.integrity = 100; // volantín nuevo
    h.state = s;
  }

  /** El cliente avisa que su hilo se cortó solo (desgaste por sobretensión). */
  selfBroken(h: Human) {
    const s = h.state;
    if (!s?.k || s.fid === h.deadFid) return;
    h.deadFid = s.fid;
    this.dropKite(h.id, h.name, h.design, h.loadout, s);
    this.broadcast({ t: 'cut', victim: h.id, cutter: null });
  }

  /** Bots de relleno: 3 con una persona, 2 con dos, 1 con tres, ninguno con cuatro o más. */
  private syncBots() {
    const want = Math.max(0, 4 - Math.max(1, this.humans.size));
    while (this.bots.length > want) this.bots.pop();
    while (this.bots.length < want) {
      const slot = 7 - this.bots.length;
      // Nombre que no se repita en la sala
      const used = new Set(this.bots.map((x) => x.name));
      let index = Math.floor(Math.random() * BOT_NAMES.length);
      while (used.has(BOT_NAMES[index % BOT_NAMES.length])) index++;
      this.bots.push(new Bot(newId('b'), slot, index % BOT_NAMES.length));
    }
  }

  info(): NetPlayerInfo[] {
    return [
      ...[...this.humans.values()].map((h) => ({ id: h.id, name: h.name, look: h.look, design: h.design, gear: h.gear, bot: false })),
      ...this.bots.map((b) => ({ id: b.id, name: b.name, look: b.look, design: b.design, gear: b.gear, bot: true })),
    ];
  }

  private send(h: Human, msg: ServerMsg) {
    if (h.ws.readyState === h.ws.OPEN) h.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const h of this.humans.values()) if (h.ws.readyState === h.ws.OPEN) h.ws.send(data);
  }

  private dropKite(owner: string, ownerName: string, design: KiteDesign, lo: Loadout, s: NetState) {
    if (!s.k) return;
    const kite = createKite({ x: 0, y: 0, z: 0 }, 1, 0);
    applyNetKite(kite, s.k);
    kite.broken = true;
    kite.stowed = false;
    const f: Fallen = { id: newId('f'), owner, ownerName, design, lo, kite, groundTime: 0 };
    this.fallen.push(f);
    this.broadcast({ t: 'fallen', id: f.id, owner, ownerName, design, kite: lo.kite.id, p: s.k.p, h: s.k.h });
  }

  private humanLine(h: Human): LineBody | null {
    const s = h.state;
    if (!s?.k || !s.rope || s.k.s === 1 || s.fid === h.deadFid) return null;
    const k = h.scratchKite;
    applyNetKite(k, s.k);
    k.broken = false;
    k.integrity = h.integrity;
    const n = s.rope.length / 3;
    while (h.scratchPts.length < n) h.scratchPts.push({ x: 0, y: 0, z: 0 });
    h.scratchPts.length = n;
    decodeRope(s.rope, h.scratchPts);
    return { id: h.id, pts: h.scratchPts, kite: k, lo: h.loadout };
  }

  private tick() {
    if (this.humans.size === 0) {
      if (Date.now() - this.emptySince > EMPTY_ROOM_TTL) this.onEmpty(this);
      return;
    }
    const dt = TICK / SUBSTEPS;
    const views: BotView[] = [];
    for (const h of this.humans.values()) {
      const line = this.humanLine(h);
      if (line) views.push({ id: h.id, anchor: line.pts[0], kite: line.kite, lo: h.loadout });
    }
    for (const b of this.bots) if (b.flying) views.push({ id: b.id, anchor: b.anchor, kite: b.kite!, lo: b.loadout });

    // Bots y volantines caídos (física a 120 Hz)
    for (let i = 0; i < SUBSTEPS; i++) {
      this.time += dt;
      const wind = windAt(this.time, 10);
      for (const b of this.bots) {
        const { input, move } = updateBotBody(b, {
          dt,
          wind,
          rivals: views.filter((v) => v.id !== b.id),
          contacts: this.contacts,
          rand: Math.random,
          nearestFallen: (p) => this.nearestFallen(p),
          launch: () => b.launch(wind),
        });
        b.vel.x = move.x;
        b.vel.z = move.z;
        b.pos.x += move.x * dt;
        b.pos.z += move.z * dt;
        b.pos.y = groundHeight(b.pos.x, b.pos.z);
        if (Math.hypot(move.x, move.z) > 0.2) b.facing = Math.atan2(move.x, move.z);
        b.updateAnchor();
        const k = b.kite;
        if (!k) continue;
        const alt = k.pos.y - groundHeight(k.pos.x, k.pos.z);
        const w = windAt(this.time, alt);
        stepKite(k, b.loadout, input, b.anchor, b.vel, w, dt);
        if (!k.stowed) {
          const acc = { x: w.x * 0.15, y: -9.8, z: w.z * 0.15 };
          b.rope.step(b.anchor, k.broken ? null : k.pos, k.lineLength * (1.004 + 0.03 * (1 - k.tension)), acc, 0.02, dt, 8);
        }
      }
      for (const f of this.fallen) {
        const alt = f.kite.pos.y - groundHeight(f.kite.pos.x, f.kite.pos.z);
        stepKite(f.kite, f.lo, NO_INPUT, f.kite.pos, f.kite.vel, windAt(this.time, alt), dt);
        if (f.kite.grounded) f.groundTime += dt;
      }
    }

    // Cruces de hilos: personas (según lo que reportan) y bots
    const lines: LineBody[] = [];
    for (const h of this.humans.values()) {
      const l = this.humanLine(h);
      if (l) lines.push(l);
    }
    for (const b of this.bots) if (b.flying) lines.push({ id: b.id, pts: b.rope.pts, kite: b.kite!, lo: b.loadout });
    const contacts = resolveCrossings(lines, TICK, this.hooks);
    this.contacts.clear();
    this.crossingOf.clear();
    const lastDamager = new Map<string, string>();
    for (const c of contacts) {
      this.contacts.add(c.a).add(c.b);
      this.crossingOf.set(c.a, c.b);
      this.crossingOf.set(c.b, c.a);
      lastDamager.set(c.a, c.b);
      lastDamager.set(c.b, c.a);
    }
    for (const h of this.humans.values()) {
      const l = lines.find((x) => x.id === h.id);
      if (!l) continue;
      h.integrity = l.kite.integrity;
      if (l.kite.broken && h.state) {
        h.deadFid = h.state.fid;
        this.dropKite(h.id, h.name, h.design, h.loadout, h.state);
        this.broadcast({ t: 'cut', victim: h.id, cutter: lastDamager.get(h.id) ?? null });
      }
    }
    for (const b of this.bots) {
      if (!b.kite?.broken) continue;
      const cutter = b.kite.integrity <= 0 ? (lastDamager.get(b.id) ?? null) : null;
      this.dropKite(b.id, b.name, b.design, b.loadout, b.netState());
      b.kite = null;
      this.broadcast({ t: 'cut', victim: b.id, cutter });
    }

    // Capturas: el más cercano a un volantín caído (a menos de 2,4 m) se lo queda
    const walkers: { id: string; p: V3 }[] = [
      ...[...this.humans.values()].filter((h) => h.state).map((h) => ({ id: h.id, p: { x: h.state!.p[0], y: h.state!.p[1], z: h.state!.p[2] } })),
      ...this.bots.map((b) => ({ id: b.id, p: b.pos })),
    ];
    for (const f of [...this.fallen]) {
      const k = f.kite;
      if (f.groundTime > FALLEN_LIFETIME) {
        this.fallen.splice(this.fallen.indexOf(f), 1);
        this.broadcast({ t: 'captured', fallen: f.id, by: '' });
        continue;
      }
      if (k.pos.y - groundHeight(k.pos.x, k.pos.z) > 2.5) continue;
      let best: string | null = null;
      let bestD = CAPTURE_RADIUS;
      for (const w of walkers) {
        const d = Math.hypot(w.p.x - k.pos.x, w.p.z - k.pos.z);
        if (d < bestD) {
          bestD = d;
          best = w.id;
        }
      }
      if (!best) continue;
      this.fallen.splice(this.fallen.indexOf(f), 1);
      this.broadcast({ t: 'captured', fallen: f.id, by: best });
      const bot = this.bots.find((b) => b.id === best);
      if (bot) bot.botState = 'volver';
    }

    // Snapshot para todos
    this.broadcast({
      t: 'snap',
      time: Math.round(this.time * 1000) / 1000,
      players: [
        ...[...this.humans.values()]
          .filter((h) => h.state)
          .map((h) => ({ id: h.id, s: h.state!, I: Math.round(h.integrity), x: this.crossingOf.get(h.id) ?? null })),
        ...this.bots.map((b) => ({ id: b.id, s: b.netState(), I: Math.round(b.kite?.integrity ?? 100), x: this.crossingOf.get(b.id) ?? null })),
      ],
      fallen: this.fallen.map((f) => ({
        id: f.id,
        p: [Math.round(f.kite.pos.x * 100) / 100, Math.round(f.kite.pos.y * 100) / 100, Math.round(f.kite.pos.z * 100) / 100],
        h: Math.round(f.kite.heading * 1000) / 1000,
        g: f.kite.grounded ? 1 : 0,
      })),
    });
  }

  private nearestFallen(p: V3) {
    let best: Fallen | null = null;
    let bestD = Infinity;
    for (const f of this.fallen) {
      const d = Math.hypot(f.kite.pos.x - p.x, f.kite.pos.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best ? { pos: best.kite.pos, dist: bestD } : null;
  }
}

/** Todas las salas del servidor. */
export class Lobby {
  private rooms = new Map<string, Room>();

  /** '' = partida rápida (sala pública con espacio), 'NUEVA' = sala privada nueva, otro = código. */
  find(request: string): Room | string {
    const code = request.trim().toUpperCase();
    if (code === '') {
      for (const r of this.rooms.values()) if (!r.isPrivate && !r.full) return r;
      return this.create(false);
    }
    if (code === 'NUEVA') return this.create(true);
    const r = this.rooms.get(code);
    if (!r) return 'No existe una sala con ese código.';
    if (r.full) return 'La sala está llena.';
    return r;
  }

  private create(isPrivate: boolean) {
    let code = roomCode();
    while (this.rooms.has(code)) code = roomCode();
    const room = new Room(code, isPrivate, (r) => {
      r.close();
      this.rooms.delete(r.code);
    });
    this.rooms.set(code, room);
    return room;
  }

  get stats() {
    return { rooms: this.rooms.size, players: [...this.rooms.values()].reduce((n, r) => n + r.humans.size, 0) };
  }
}
