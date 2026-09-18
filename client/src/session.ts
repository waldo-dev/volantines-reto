import {
  DEFAULT_DESIGN,
  DEFAULT_GEAR,
  DEFAULT_LOOK,
  EMPTY_STATS,
  applyEvents,
  buyError,
  catalogItem,
  isSpecialDesign,
  levelInfo,
  owns,
  sanitizeDesign,
  sanitizeLook,
  type GameEvents,
  type Gear,
  type KiteDesign,
  type Look,
  type Progress,
  type Stats,
} from '@volantines/shared';

/** Lo que el juego necesita saber del jugador, venga del servidor o del navegador (invitado). */
export interface PlayerData extends Progress {
  name: string;
  look: Look;
  design: KiteDesign;
  gear: Gear;
  captured: KiteDesign[];
}

export interface Rewards {
  coins: number;
  xp: number;
  levelUp: number | null;
  achievements: { id: string; nombre: string; monedas: number }[];
}

const TOKEN_KEY = 'volantines.token';
const GUEST_KEY = 'volantines.guest.v1';
const MAX_CAPTURED = 30;

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // sin almacenamiento: la sesión dura lo que dure la pestaña
    }
  },
};

async function api<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Error ${res.status}`), { status: res.status });
  return data;
}

function freshGuest(): PlayerData {
  // Toma lo que el jugador ya había personalizado en la versión anterior (perfil local)
  let old: { look?: Look; design?: KiteDesign } = {};
  try {
    old = JSON.parse(store.get('volantines.profile.v1') ?? '{}');
  } catch {
    old = {};
  }
  return {
    name: 'Invitado',
    xp: 0,
    coins: 0,
    stats: { ...EMPTY_STATS },
    achievements: [],
    owned: [],
    look: sanitizeLook(old.look ?? DEFAULT_LOOK),
    design: sanitizeDesign(old.design ?? DEFAULT_DESIGN),
    gear: { ...DEFAULT_GEAR },
    captured: [],
  };
}

/**
 * Sesión del jugador. Con cuenta, el servidor guarda y valida todo (progreso, compras, logros).
 * Como invitado se juega igual, pero el progreso queda solo en este navegador.
 */
export class Session {
  data: PlayerData;
  token: string | null = store.get(TOKEN_KEY);
  /** Se llama cuando cambian los datos (nivel, monedas, equipo...). */
  onChange: () => void = () => {};
  /** Se llama con las recompensas de cada reporte. */
  onRewards: (r: Rewards) => void = () => {};

  private pending: GameEvents = { ...EMPTY_STATS };
  private pendingCaptured: KiteDesign[] = [];
  private lastGuestReport = performance.now();
  private reporting = false;
  private saveTimer = 0;

  constructor() {
    this.data = this.loadGuest();
  }

  get isGuest() {
    return this.token === null;
  }

  get level() {
    return levelInfo(this.data.xp);
  }

  owns(key: string) {
    return owns(this.data, key);
  }

  buyError(key: string) {
    return buyError(this.data, key);
  }

  /** Intenta recuperar la sesión guardada; si el token venció, sigue como invitado. */
  async restore() {
    if (!this.token) return;
    try {
      const { player } = await api<{ player: PlayerData }>('GET', '/me', undefined, this.token);
      this.data = player;
    } catch (err) {
      if ((err as { status?: number }).status === 401) this.setToken(null);
    }
    this.onChange();
  }

  async register(name: string, password: string) {
    const r = await api<{ token: string; player: PlayerData }>('POST', '/auth/register', { name, password });
    this.setToken(r.token);
    this.data = r.player;
    // La apariencia que el invitado ya había elegido pasa a la cuenta nueva
    const guest = this.loadGuest();
    const design = isSpecialDesign(guest.design.pattern) ? { ...guest.design, pattern: DEFAULT_DESIGN.pattern } : guest.design;
    await this.saveCustomization({ look: guest.look, design }, true);
    this.onChange();
  }

  async login(name: string, password: string) {
    const r = await api<{ token: string; player: PlayerData }>('POST', '/auth/login', { name, password });
    this.setToken(r.token);
    this.data = r.player;
    this.onChange();
  }

  async logout() {
    await this.flush();
    if (this.token) await api('POST', '/auth/logout', {}, this.token).catch(() => undefined);
    this.setToken(null);
    this.data = this.loadGuest();
    this.onChange();
  }

  /** Cambia apariencia, diseño, equipo o nombre. Con cuenta se guarda en el servidor (agrupando cambios seguidos). */
  async saveCustomization(patch: Partial<Pick<PlayerData, 'look' | 'design' | 'gear' | 'name'>>, immediate = false) {
    Object.assign(this.data, patch);
    if (this.isGuest) {
      this.saveGuest();
      return;
    }
    clearTimeout(this.saveTimer);
    const send = async () => {
      const d = this.data;
      const r = await api<{ player: PlayerData }>('PUT', '/me', { look: d.look, design: d.design, gear: d.gear, name: d.name }, this.token);
      this.data = { ...r.player };
      this.onChange();
    };
    if (immediate) return send();
    this.saveTimer = window.setTimeout(() => void send().catch((e) => console.warn(e)), 600);
  }

  async buy(key: string) {
    if (this.isGuest) {
      // Invitado: la compra queda solo en este navegador
      const err = buyError(this.data, key);
      if (err) throw new Error(err);
      const item = catalogItem(key)!;
      this.data.coins -= item.precio;
      this.data.owned.push(key);
      this.saveGuest();
      this.onChange();
      return item;
    }
    const r = await api<{ player: PlayerData }>('POST', '/shop/buy', { item: key }, this.token);
    this.data = r.player;
    this.onChange();
    return catalogItem(key);
  }

  // --- Eventos de juego ---

  add(event: keyof Stats, value = 1) {
    if (event === 'bestAltitude' || event === 'longestFlight') this.pending[event] = Math.max(this.pending[event], value);
    else this.pending[event] += value;
  }

  capture(design: KiteDesign) {
    this.pending.captures++;
    this.pendingCaptured.push(design);
  }

  private hasPending() {
    const p = this.pending;
    return p.flightSeconds >= 1 || p.cuts || p.captures || p.cutBy || p.stows || p.fullLine || p.bestAltitude > this.data.stats.bestAltitude || p.longestFlight > this.data.stats.longestFlight;
  }

  /** Envía lo acumulado (se llama cada ~15 s y justo después de cortes y capturas). */
  async flush() {
    if (this.reporting || !this.hasPending()) return;
    const events = { ...this.pending, flightSeconds: Math.floor(this.pending.flightSeconds) };
    const captured = this.pendingCaptured;
    this.pending = { ...EMPTY_STATS, flightSeconds: this.pending.flightSeconds - events.flightSeconds };
    this.pendingCaptured = [];

    if (this.isGuest) {
      const now = performance.now();
      const r = applyEvents(this.data, events, (now - this.lastGuestReport) / 1000 + 1);
      this.lastGuestReport = now;
      this.data.captured = [...captured, ...this.data.captured].slice(0, MAX_CAPTURED);
      this.saveGuest();
      this.onRewards({ coins: r.coins, xp: r.xp, levelUp: r.levelUp, achievements: r.unlocked });
      this.onChange();
      return;
    }
    this.reporting = true;
    try {
      const r = await api<{ player: PlayerData; rewards: Rewards }>('POST', '/me/report', { events, captured }, this.token);
      this.data = r.player;
      this.onRewards(r.rewards);
      this.onChange();
    } catch (err) {
      console.warn('No se pudo guardar el progreso; se reintenta en el próximo reporte.', err);
      // Se devuelve lo no enviado para no perderlo
      for (const k of Object.keys(events) as (keyof Stats)[]) this.add(k, events[k]);
      this.pendingCaptured.unshift(...captured);
    } finally {
      this.reporting = false;
    }
  }

  private setToken(t: string | null) {
    this.token = t;
    store.set(TOKEN_KEY, t);
  }

  private loadGuest(): PlayerData {
    try {
      const raw = store.get(GUEST_KEY);
      if (raw) {
        const g = JSON.parse(raw) as PlayerData;
        return { ...freshGuest(), ...g, stats: { ...EMPTY_STATS, ...g.stats }, look: sanitizeLook(g.look), design: sanitizeDesign(g.design) };
      }
    } catch {
      // perfil dañado: se parte de cero
    }
    return freshGuest();
  }

  private saveGuest() {
    store.set(GUEST_KEY, JSON.stringify(this.data));
  }
}
