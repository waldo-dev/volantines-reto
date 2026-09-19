import {
  BOT_NAMES,
  DEFAULT_GEAR,
  DELIVERY_RADIUS,
  DROP_LOCK,
  EMPTY_STATS,
  MAX_PLAYERS,
  NET_RATE,
  Rope,
  applyNetKite,
  REWARDS,
  bagOf,
  cableSegments,
  captureValue,
  trophyOf,
  MAX_STATS,
  canReach,
  createBrain,
  createKite,
  decodeRope,
  encodeKite,
  encodeRope,
  gearLoadout,
  groundHeight,
  inBonus,
  isUpset,
  mapById,
  newCombo,
  owns,
  poleOf,
  registerCut,
  resetCombo,
  streakActive,
  randomBot,
  resolveCables,
  resolveCrossings,
  resolveTailCuts,
  roomCode,
  sanitizeAmarre,
  sanitizeDesign,
  sanitizeLook,
  spawnSlot,
  stepKite,
  updateBotBody,
  useMap,
  validSignal,
  windAt,
  type BotBody,
  type BotBrain,
  type BotView,
  type CarryItem,
  type ComboState,
  type Gear,
  type Hook,
  type KiteDesign,
  type KiteState,
  type LineBody,
  type Loadout,
  type Look,
  type MapId,
  type NetPlayerInfo,
  type NetState,
  type EventKind,
  type GameEvents,
  type Progress,
  type ServerMsg,
  type Trophy,
  type V3,
} from '@volantines/shared';
import type { WebSocket } from 'ws';
import { validateState, type Accepted, type Issue } from './validate';

/**
 * Lo que la sala necesita de afuera (base de datos y telemetría). Sin servicios (tests) no se acredita nada.
 * `credit` suma premios a una cuenta y devuelve el jugador actualizado y los premios para avisarle.
 */
export interface RoomServices {
  credit(accountId: number, events: Partial<GameEvents>, trophies: Trophy[]): Promise<{ player: Record<string, unknown>; rewards: unknown } | null>;
  event(kind: EventKind, accountId: number | null, data?: Record<string, unknown>): void;
}

/** Se acredita a la cuenta un rato después del último evento, para juntar varios en una sola escritura. */
const CREDIT_DELAY = 800;
/** Sospecha (problemas por estado, se desvanece con el tiempo) desde la que se deja un aviso en la telemetría. */
const SUSPECT_REPORT = 40;
const SUSPECT_DECAY = 4; // por segundo

const TICK = 1 / NET_RATE;
const SUBSTEPS = 6; // física a 120 Hz para bots y volantines caídos
/** Los bots recogen a mano y sin límite. */
const BOT_POLE = poleOf('mano');
const FALLEN_LIFETIME = 90;
const EMPTY_ROOM_TTL = 30_000;
const NO_INPUT = { tirar: false, soltar: false, dirX: 0 };

export const loadoutOf = (g: Gear): Loadout => gearLoadout(g);

/** Deja solo el equipo que el jugador tiene (invitados: solo lo inicial). */
export function allowedGear(g: Partial<Gear> | undefined, progress: Progress | null): Gear {
  const p: Progress = progress ?? { xp: 0, coins: 0, stats: { ...EMPTY_STATS }, achievements: [], owned: [] };
  const pick = (kind: keyof Gear, fallback: string) => {
    const id = g?.[kind];
    return typeof id === 'string' && owns(p, `${kind}:${id}`) ? id : fallback;
  };
  const amarre = sanitizeAmarre(g?.amarre);
  return {
    kite: pick('kite', 'mediano'),
    line: pick('line', 'algodon'),
    reel: pick('reel', 'mano'),
    bridle: pick('bridle', 'normal'),
    bag: pick('bag', 'bolsa'),
    pole: pick('pole', 'mano'),
    ...(amarre !== undefined ? { amarre } : {}),
  };
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
  /** Volantín (fid) al que el servidor ya le cortó la cola (por si el cliente todavía no lo sabe). */
  tailCutFid: number;
  scratchKite: KiteState;
  scratchPts: V3[];
  /** Volantines capturados que lleva en la mochila (se cobran al llegar a su casa). */
  bag: CarryItem[];
  home: V3;
  /** Cuenta (null para invitados): a ella acredita el servidor lo que pasa en la sala. */
  accountId: number | null;
  /** Último estado aceptado, para validar el siguiente. */
  accepted: Accepted | null;
  /** Sospecha acumulada por estados imposibles (se desvanece sola). */
  suspicion: number;
  suspicionAt: number;
  issues: Partial<Record<Issue, number>>;
  lastSuspectReport: number;
  /** Voz activada (solo en salas privadas). */
  voice: boolean;
  /** Premios que esperan ser acreditados a la cuenta. */
  credit: { events: Partial<GameEvents>; trophies: Trophy[]; timer: NodeJS.Timeout | null };
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
  /** Se le cayó de la mochila a este jugador: no lo puede recoger hasta `lockUntil`. */
  lockBy?: string;
  lockUntil?: number;
}

const carryOf = (f: Fallen): CarryItem => ({ design: f.design, kite: f.lo.kite.id, owner: f.owner, ownerName: f.ownerName });

let nextId = 1;
const newId = (prefix: string) => `${prefix}${(nextId++).toString(36)}`;

/** Una sala: hasta 8 personas, bots de relleno, cruces y cortes decididos por el servidor. */
export class Room {
  readonly humans = new Map<string, Human>();
  private bots: Bot[] = [];
  private fallen: Fallen[] = [];
  private hooks = new Map<string, Hook>();
  private combos = new Map<string, ComboState>();
  private contacts = new Set<string>();
  private crossingOf = new Map<string, string>();
  time = 0;
  private timer: NodeJS.Timeout;
  private emptySince = Date.now();
  /** Tramos de cable del mapa (se calculan una vez). */
  private cables: ReturnType<typeof cableSegments>;
  /** Quién se cortó en los cables (para avisarlo así). */
  private cableHits = new Set<string>();

  constructor(
    readonly code: string,
    readonly isPrivate: boolean,
    private onEmpty: (room: Room) => void,
    readonly map: MapId = 'cerro',
    private services: RoomServices | null = null,
  ) {
    // El terreno y el viento son los del mapa de la sala (se activa antes de simular)
    useMap(map);
    this.cables = cableSegments(mapById(map), groundHeight);
    this.syncBots();
    this.timer = setInterval(() => this.tick(), TICK * 1000);
  }

  get full() {
    return this.humans.size >= MAX_PLAYERS;
  }

  close() {
    clearInterval(this.timer);
  }

  join(ws: WebSocket, p: { name: string; look: Look; design: KiteDesign; gear: Gear; progress: Progress | null; accountId?: number | null }): Human {
    useMap(this.map);
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
      tailCutFid: -1,
      scratchKite: createKite({ x: 0, y: 0, z: 0 }, 1, 0),
      scratchPts: [],
      bag: [],
      home: { ...spawnSlot(slot) },
      accountId: p.accountId ?? null,
      accepted: null,
      suspicion: 0,
      suspicionAt: 0,
      issues: {},
      lastSuspectReport: -Infinity,
      voice: false,
      credit: { events: {}, trophies: [], timer: null },
    };
    this.humans.set(h.id, h);
    this.syncBots();
    const spawn = spawnSlot(slot);
    this.send(h, { t: 'welcome', id: h.id, room: this.code, private: this.isPrivate, time: this.time, spawn: [spawn.x, spawn.y, spawn.z], info: this.info(), map: this.map });
    this.broadcast({ t: 'info', info: this.info() });
    return h;
  }

  leave(h: Human) {
    useMap(this.map);
    if (h.credit.timer) {
      clearTimeout(h.credit.timer);
      this.flushCredit(h);
    }
    this.humans.delete(h.id);
    this.combos.delete(h.id);
    this.syncBots();
    this.broadcast({ t: 'info', info: this.info() });
    if (this.humans.size === 0) this.emptySince = Date.now();
  }

  /** Activa o apaga la voz de un jugador. Solo existe en salas privadas (para jugar entre conocidos). */
  setVoice(h: Human, on: boolean) {
    if (!this.isPrivate || h.voice === on) return;
    h.voice = on;
    this.broadcast({ t: 'info', info: this.info() });
  }

  /** Reenvía una señal de WebRTC entre dos jugadores de esta sala privada que tienen la voz activada. */
  relaySignal(from: Human, to: string, d: unknown) {
    if (!this.isPrivate || !from.voice || !validSignal(d)) return;
    const target = this.humans.get(to);
    if (!target || target === from || !target.voice) return;
    this.send(target, { t: 'rtc', from: from.id, d });
  }

  updateProfile(h: Human, p: { name: string; look: Look; design: KiteDesign; gear: Gear }) {
    h.name = p.name;
    h.look = sanitizeLook(p.look);
    h.design = sanitizeDesign(p.design);
    h.gear = allowedGear(p.gear, h.progress);
    h.loadout = loadoutOf(h.gear);
    this.broadcast({ t: 'info', info: this.info() });
  }

  /**
   * Estado que manda el cliente: se valida y corrige (ver validate.ts) antes de usarlo.
   * `now` en segundos (se puede pasar en los tests).
   */
  setState(h: Human, raw: NetState, now = performance.now() / 1000) {
    const v = validateState(h.accepted, raw, now, h.loadout);
    if (!v) return;
    const s = v.state;
    if (v.issues.length) this.suspect(h, v.issues, now);
    if (s.fid !== h.state?.fid) h.integrity = 100; // volantín nuevo
    h.state = s;
    h.accepted = { s, at: now };
  }

  /** Suma sospecha por estados imposibles y, si se acumula, deja un aviso en la telemetría (una vez por minuto). */
  private suspect(h: Human, issues: Issue[], now: number) {
    h.suspicion = Math.max(0, h.suspicion - (now - h.suspicionAt) * SUSPECT_DECAY) + issues.length;
    h.suspicionAt = now;
    for (const i of issues) h.issues[i] = (h.issues[i] ?? 0) + 1;
    if (h.suspicion >= SUSPECT_REPORT && now - h.lastSuspectReport > 60) {
      h.lastSuspectReport = now;
      this.services?.event('suspect', h.accountId, { name: h.name, issues: h.issues, room: this.code });
      h.issues = {};
    }
  }

  /** Premios que vio el servidor: se juntan y se acreditan a la cuenta (los invitados los cuentan en su navegador). */
  private award(h: Human | undefined, events: Partial<GameEvents>, trophies: Trophy[] = []) {
    if (!h || h.accountId === null || !this.services) return;
    const c = h.credit;
    for (const [k, v] of Object.entries(events) as [keyof GameEvents, number][]) {
      c.events[k] = MAX_STATS.includes(k) ? Math.max(c.events[k] ?? 0, v) : (c.events[k] ?? 0) + v;
    }
    c.trophies.push(...trophies);
    if (c.timer) return;
    c.timer = setTimeout(() => this.flushCredit(h), CREDIT_DELAY);
  }

  private flushCredit(h: Human) {
    const c = h.credit;
    c.timer = null;
    const events = c.events;
    const trophies = c.trophies;
    c.events = {};
    c.trophies = [];
    if (h.accountId === null || !this.services) return;
    void this.services
      .credit(h.accountId, events, trophies)
      .then((r) => {
        if (r) this.send(h, { t: 'rewards', player: r.player, rewards: r.rewards });
      })
      .catch((err) => console.warn('No se pudo acreditar a la cuenta:', (err as Error).message));
  }

  /** El cliente avisa que su hilo se cortó solo (desgaste por sobretensión). */
  selfBroken(h: Human) {
    useMap(this.map);
    const s = h.state;
    if (!s?.k || s.fid === h.deadFid) return;
    h.deadFid = s.fid;
    this.dropKite(h.id, h.name, h.design, h.loadout, s);
    this.dropCarried(h);
    resetCombo(this.combo(h.id));
    this.broadcast({ t: 'cut', victim: h.id, cutter: null });
  }

  /** Al que cortan con la mochila cargada se le cae un volantín donde está parado. */
  private dropCarried(h: Human) {
    const item = h.bag.pop();
    if (!item || !h.state) return;
    const [x, , z] = h.state.p;
    const p: V3 = { x: x + 0.8, y: groundHeight(x + 0.8, z) + 0.3, z };
    const lo = loadoutOf({ ...DEFAULT_GEAR, kite: item.kite });
    const kite = createKite(p, 1, 0);
    kite.pos = { ...p };
    kite.broken = true;
    const f: Fallen = {
      id: newId('f'),
      owner: item.owner,
      ownerName: item.ownerName,
      design: item.design,
      lo,
      kite,
      groundTime: 0,
      lockBy: h.id,
      lockUntil: this.time + DROP_LOCK,
    };
    this.fallen.push(f);
    this.broadcast({ t: 'fallen', id: f.id, owner: f.owner, ownerName: f.ownerName, design: f.design, kite: lo.kite.id, p: [p.x, p.y, p.z], h: 0 });
  }

  private combo(id: string) {
    let c = this.combos.get(id);
    if (!c) this.combos.set(id, (c = newCombo()));
    return c;
  }

  private boosted(id: string) {
    const c = this.combos.get(id);
    return !!c && streakActive(c, this.time);
  }

  /** Anuncia un corte: suma el combo del que cortó (y su racha) y borra el del cortado. */
  private announceCut(victim: string, victimLo: Loadout, cutter: string | null) {
    resetCombo(this.combo(victim));
    const vh = this.humans.get(victim);
    if (vh && cutter) {
      this.award(vh, { cutBy: 1 });
      this.services?.event('cut_by', vh.accountId, { map: this.map });
    }
    if (!cutter) {
      this.broadcast({ t: 'cut', victim, cutter: null, ...(this.cableHits.has(victim) ? { cable: 1 as const } : {}) });
      return;
    }
    const cutterKite = this.humans.get(cutter)?.scratchKite ?? this.bots.find((b) => b.id === cutter)?.kite;
    const bonus = !!cutterKite && inBonus(mapById(this.map), cutterKite.pos);
    const ch = this.humans.get(cutter);
    const { combo, streakStarted } = registerCut(this.combo(cutter), this.time);
    const cutterLo = this.humans.get(cutter)?.loadout ?? this.bots.find((b) => b.id === cutter)?.loadout;
    this.broadcast({
      t: 'cut',
      victim,
      cutter,
      ...(combo > 1 ? { combo } : {}),
      ...(cutterLo && isUpset(cutterLo.line, victimLo.line) ? { upset: 1 as const } : {}),
      ...(streakStarted ? { streak: 1 as const } : {}),
      ...(bonus ? { bonus: 1 as const } : {}),
    });
    if (ch) {
      const upset = !!cutterLo && isUpset(cutterLo.line, victimLo.line);
      this.award(ch, { cuts: 1, comboCuts: combo > 1 ? 1 : 0, bestCombo: combo, upsets: upset ? 1 : 0, bonusCuts: bonus ? 1 : 0 });
      this.services?.event('cut', ch.accountId, { combo, upset, bonus, map: this.map, victimBot: !vh });
    }
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
      ...[...this.humans.values()].map((h) => ({ id: h.id, name: h.name, look: h.look, design: h.design, gear: h.gear, bot: false, ...(h.voice ? { voice: 1 as const } : {}) })),
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
    if (h.tailCutFid === s.fid) k.tailCut = true;
    const n = s.rope.length / 3;
    while (h.scratchPts.length < n) h.scratchPts.push({ x: 0, y: 0, z: 0 });
    h.scratchPts.length = n;
    decodeRope(s.rope, h.scratchPts);
    return { id: h.id, pts: h.scratchPts, kite: k, lo: h.loadout, boost: this.boosted(h.id) };
  }

  private tick() {
    if (this.humans.size === 0) {
      if (Date.now() - this.emptySince > EMPTY_ROOM_TTL) this.onEmpty(this);
      return;
    }
    useMap(this.map);
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
    for (const b of this.bots) if (b.flying) lines.push({ id: b.id, pts: b.rope.pts, kite: b.kite!, lo: b.loadout, boost: this.boosted(b.id) });
    this.cableHits.clear();
    for (const c of resolveCables(lines, this.cables, TICK)) this.cableHits.add(c.id);
    const contacts = resolveCrossings(lines, TICK, this.hooks);
    for (const tc of resolveTailCuts(lines)) {
      const h = this.humans.get(tc.victim);
      if (h?.state) h.tailCutFid = h.state.fid;
      const p: [number, number, number] = [Math.round(tc.point.x * 100) / 100, Math.round(tc.point.y * 100) / 100, Math.round(tc.point.z * 100) / 100];
      this.broadcast({ t: 'tail', by: tc.by, victim: tc.victim, p });
      const by = this.humans.get(tc.by);
      if (by) {
        this.award(by, { tailCuts: 1 });
        this.services?.event('tail', by.accountId);
      }
    }
    this.contacts.clear();
    this.crossingOf.clear();
    const lastDamager = new Map<string, string>();
    for (const c of contacts) {
      this.contacts.add(c.a).add(c.b);
      this.crossingOf.set(c.a, c.b);
      this.crossingOf.set(c.b, c.a);
      lastDamager.set(c.a, c.b);
      lastDamager.set(c.b, c.a);
      const p: [number, number, number] = [Math.round(c.point.x * 100) / 100, Math.round(c.point.y * 100) / 100, Math.round(c.point.z * 100) / 100];
      for (const cr of c.crits) {
        this.broadcast({ t: 'crit', by: cr.by, victim: cr.victim, kind: cr.kind, p });
        const by = this.humans.get(cr.by);
        if (by) {
          this.award(by, { crits: 1 });
          this.services?.event('crit', by.accountId, { kind: cr.kind });
        }
      }
    }
    for (const h of this.humans.values()) {
      const l = lines.find((x) => x.id === h.id);
      if (!l) continue;
      h.integrity = l.kite.integrity;
      if (l.kite.broken && h.state) {
        h.deadFid = h.state.fid;
        this.dropKite(h.id, h.name, h.design, h.loadout, h.state);
        this.dropCarried(h);
        this.announceCut(h.id, h.loadout, this.cableHits.has(h.id) ? null : (lastDamager.get(h.id) ?? null));
      }
    }
    for (const b of this.bots) {
      if (!b.kite?.broken) continue;
      const cutter = b.kite.integrity <= 0 && !this.cableHits.has(b.id) ? (lastDamager.get(b.id) ?? null) : null;
      this.dropKite(b.id, b.name, b.design, b.loadout, b.netState());
      b.kite = null;
      this.announceCut(b.id, b.loadout, cutter);
    }

    // Capturas: el más cercano que alcance (según su colihue) y tenga espacio en la mochila se lo queda
    const walkers: { id: string; p: V3; human: Human | null }[] = [
      ...[...this.humans.values()]
        .filter((h) => h.state && h.bag.length < bagOf(h.gear.bag).capacidad)
        .map((h) => ({ id: h.id, p: { x: h.state!.p[0], y: h.state!.p[1], z: h.state!.p[2] }, human: h })),
      ...this.bots.map((b) => ({ id: b.id, p: b.pos, human: null })),
    ];
    for (const f of [...this.fallen]) {
      const k = f.kite;
      if (f.groundTime > FALLEN_LIFETIME) {
        this.fallen.splice(this.fallen.indexOf(f), 1);
        this.broadcast({ t: 'captured', fallen: f.id, by: '' });
        continue;
      }
      const height = k.pos.y - groundHeight(k.pos.x, k.pos.z);
      let best: (typeof walkers)[number] | null = null;
      let bestD = Infinity;
      for (const w of walkers) {
        const d = Math.hypot(w.p.x - k.pos.x, w.p.z - k.pos.z);
        if (f.lockBy === w.id && this.time < (f.lockUntil ?? 0)) continue;
        const pole = w.human ? poleOf(w.human.gear.pole) : BOT_POLE;
        if (d < bestD && canReach(pole, d, height)) {
          bestD = d;
          best = w;
        }
      }
      if (!best) continue;
      this.fallen.splice(this.fallen.indexOf(f), 1);
      this.broadcast({ t: 'captured', fallen: f.id, by: best.id });
      if (best.human) {
        best.human.bag.push(carryOf(f));
        // Mochila llena: ya no recoge más hasta entregar
        if (best.human.bag.length >= bagOf(best.human.gear.bag).capacidad) walkers.splice(walkers.indexOf(best), 1);
      }
      const bot = this.bots.find((b) => b.id === best.id);
      if (bot) bot.botState = 'volver';
      continue;
    }

    // Entregas: con volantines en la mochila y parado en su casa
    for (const h of this.humans.values()) {
      if (!h.bag.length || !h.state) continue;
      if (Math.hypot(h.state.p[0] - h.home.x, h.state.p[2] - h.home.z) > DELIVERY_RADIUS) continue;
      const items = h.bag.splice(0);
      this.broadcast({ t: 'delivered', by: h.id, items });
      // Lo que paga la entrega lo calcula el servidor con el colihue que de verdad tiene
      const pole = poleOf(h.gear.pole);
      const coins = items.reduce((sum, it) => sum + captureValue(it.kite, pole), 0);
      this.award(
        h,
        { captures: items.length, captureBonus: coins - REWARDS.capture * items.length, bestDelivery: items.length },
        items.map((it) => trophyOf(it)),
      );
      this.services?.event('delivery', h.accountId, { n: items.length, coins, map: this.map });
    }

    // Snapshot para todos
    this.broadcast({
      t: 'snap',
      time: Math.round(this.time * 1000) / 1000,
      players: [
        ...[...this.humans.values()]
          .filter((h) => h.state)
          .map((h) => ({ id: h.id, s: h.state!, I: Math.round(h.integrity), x: this.crossingOf.get(h.id) ?? null, ...(this.boosted(h.id) ? { b: 1 as const } : {}) })),
        ...this.bots.map((b) => ({
          id: b.id,
          s: b.netState(),
          I: Math.round(b.kite?.integrity ?? 100),
          x: this.crossingOf.get(b.id) ?? null,
          ...(this.boosted(b.id) ? { b: 1 as const } : {}),
        })),
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

  constructor(private services: RoomServices | null = null) {}

  /** '' = partida rápida (sala pública con espacio en ese mapa), 'NUEVA' = sala privada nueva, otro = código. */
  find(request: string, map: MapId = 'cerro'): Room | string {
    const code = request.trim().toUpperCase();
    if (code === '') {
      for (const r of this.rooms.values()) if (!r.isPrivate && !r.full && r.map === map) return r;
      return this.create(false, map);
    }
    if (code === 'NUEVA') return this.create(true, map);
    const r = this.rooms.get(code);
    if (!r) return 'No existe una sala con ese código.';
    if (r.full) return 'La sala está llena.';
    return r;
  }

  private create(isPrivate: boolean, map: MapId) {
    let code = roomCode();
    while (this.rooms.has(code)) code = roomCode();
    const room = new Room(
      code,
      isPrivate,
      (r) => {
        r.close();
        this.rooms.delete(r.code);
      },
      map,
      this.services,
    );
    this.rooms.set(code, room);
    return room;
  }

  get stats() {
    return { rooms: this.rooms.size, players: [...this.rooms.values()].reduce((n, r) => n + r.humans.size, 0) };
  }
}
