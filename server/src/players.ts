import {
  ACHIEVEMENTS,
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
  MAX_TROPHIES,
  sanitizeAmarre,
  sanitizeDesign,
  sanitizeTrophy,
  sanitizeLook,
  type GameEvents,
  type Gear,
  type KiteDesign,
  type Look,
  type Progress,
  type Stats,
  type Trophy,
} from '@volantines/shared';
import type { PoolClient } from 'pg';
import { pool } from './db';

interface Row {
  id: number;
  name: string;
  xp: number;
  coins: number;
  stats: Partial<Stats>;
  look: Partial<Look>;
  design: Partial<KiteDesign>;
  gear: Partial<Gear>;
  captured: unknown[];
  last_report: Date;
}

export interface PlayerState extends Progress {
  id: number;
  name: string;
  look: Look;
  design: KiteDesign;
  gear: Gear;
  captured: Trophy[];
  lastReport: Date;
}

type Db = PoolClient | typeof pool;

/** Carga el jugador con su inventario y logros. `forUpdate` bloquea la fila dentro de una transacción. */
export async function loadPlayer(db: Db, id: number, forUpdate = false): Promise<PlayerState | null> {
  const { rows } = await db.query<Row>(`SELECT * FROM players WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  const r = rows[0];
  if (!r) return null;
  const inv = await db.query<{ item: string }>('SELECT item FROM inventory WHERE player_id = $1', [id]);
  const ach = await db.query<{ achievement_id: string }>('SELECT achievement_id FROM achievements WHERE player_id = $1', [id]);
  return {
    id: r.id,
    name: r.name,
    xp: r.xp,
    coins: r.coins,
    stats: { ...EMPTY_STATS, ...r.stats },
    look: sanitizeLook(r.look),
    design: sanitizeDesign({ ...DEFAULT_DESIGN, ...r.design }),
    gear: { ...DEFAULT_GEAR, ...r.gear },
    // Los trofeos viejos eran solo el diseño: se convierten al leerlos
    captured: (r.captured ?? []).map((t) => sanitizeTrophy(t)).filter((t): t is Trophy => !!t),
    owned: inv.rows.map((i) => i.item),
    achievements: ach.rows.map((a) => a.achievement_id),
    lastReport: r.last_report,
  };
}

/** Lo que ve el cliente. */
export function publicPlayer(p: PlayerState) {
  const lvl = levelInfo(p.xp);
  return {
    name: p.name,
    level: lvl.level,
    xp: p.xp,
    xpInto: lvl.into,
    xpNeed: lvl.need,
    coins: p.coins,
    stats: p.stats,
    achievements: p.achievements,
    owned: p.owned,
    look: p.look,
    design: p.design,
    gear: p.gear,
    captured: p.captured,
  };
}

export async function createPlayer(name: string, passHash: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO players (name, name_key, pass_hash, look, design, gear, stats)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (name_key) DO NOTHING RETURNING id`,
    [name, name.toLowerCase(), passHash, DEFAULT_LOOK, DEFAULT_DESIGN, DEFAULT_GEAR, EMPTY_STATS],
  );
  return rows[0]?.id ?? null;
}

export async function findByName(name: string) {
  const { rows } = await pool.query<{ id: number; pass_hash: string }>('SELECT id, pass_hash FROM players WHERE name_key = $1', [
    name.trim().toLowerCase(),
  ]);
  return rows[0] ?? null;
}

/** Ejecuta `fn` en una transacción con la fila del jugador bloqueada. */
export async function withPlayer<T>(id: number, fn: (p: PlayerState, db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await loadPlayer(client, id, true);
    if (!p) throw new HttpError(404, 'Jugador no encontrado.');
    const out = await fn(p, client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Guarda apariencia, diseño y equipo; solo acepta equipo y diseños especiales que el jugador tenga. */
export async function saveCustomization(p: PlayerState, db: PoolClient, body: { look?: Look; design?: KiteDesign; gear?: Gear; name?: string }) {
  if (body.look) p.look = sanitizeLook(body.look);
  if (body.design) {
    const d = sanitizeDesign(body.design);
    if (isSpecialDesign(d.pattern) && !owns(p, `design:${d.pattern}`)) throw new HttpError(403, 'Ese diseño todavía no es tuyo.');
    p.design = d;
  }
  if (body.gear) {
    const g = { ...p.gear };
    for (const kind of ['kite', 'line', 'reel', 'bridle', 'bag', 'pole'] as const) {
      const id = body.gear[kind];
      if (typeof id !== 'string' || !catalogItem(`${kind}:${id}`)) continue;
      if (!owns(p, `${kind}:${id}`)) throw new HttpError(403, 'Ese equipo todavía no es tuyo.');
      g[kind] = id;
    }
    // El cliente manda el equipo completo: sin perilla, los tirantes quedan como vienen
    const amarre = sanitizeAmarre(body.gear.amarre);
    if (amarre === undefined) delete g.amarre;
    else g.amarre = amarre;
    p.gear = g;
  }
  await db.query('UPDATE players SET look = $2, design = $3, gear = $4 WHERE id = $1', [p.id, p.look, p.design, p.gear]);
}

export async function buy(p: PlayerState, db: PoolClient, key: string) {
  const err = buyError(p, key);
  if (err) throw new HttpError(400, err);
  const item = catalogItem(key)!;
  p.coins -= item.precio;
  p.owned.push(key);
  await db.query('UPDATE players SET coins = $2 WHERE id = $1', [p.id, p.coins]);
  await db.query('INSERT INTO inventory (player_id, item) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, key]);
}

/** Suma un reporte de juego (acotado por el tiempo real transcurrido) y guarda capturas nuevas. */
export async function report(p: PlayerState, db: PoolClient, events: Partial<GameEvents>, captured: unknown) {
  const elapsed = Math.min(600, Math.max(1, (Date.now() - p.lastReport.getTime()) / 1000));
  const capturesBefore = p.stats.captures;
  const result = applyEvents(p, events, elapsed);
  // Solo se guardan tantos diseños capturados como capturas aceptó el reporte
  const accepted = p.stats.captures - capturesBefore;
  if (Array.isArray(captured) && accepted > 0) {
    const fresh = captured
      .slice(0, accepted)
      .map((t) => sanitizeTrophy(t))
      .filter((t): t is Trophy => !!t);
    p.captured = [...fresh, ...p.captured].slice(0, MAX_TROPHIES);
  }
  await db.query('UPDATE players SET xp = $2, coins = $3, stats = $4, captured = $5, last_report = now() WHERE id = $1', [
    p.id,
    p.xp,
    p.coins,
    p.stats,
    JSON.stringify(p.captured),
  ]);
  for (const a of result.unlocked) {
    await db.query('INSERT INTO achievements (player_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, a.id]);
  }
  return {
    coins: result.coins,
    xp: result.xp,
    levelUp: result.levelUp,
    achievements: result.unlocked.map((a) => ({ id: a.id, nombre: a.nombre, monedas: a.monedas })),
  };
}

export async function rename(p: PlayerState, db: PoolClient, name: string) {
  const taken = await db.query('SELECT 1 FROM players WHERE name_key = $1 AND id <> $2', [name.toLowerCase(), p.id]);
  if (taken.rowCount) throw new HttpError(409, 'Ese nombre ya está ocupado.');
  p.name = name;
  await db.query('UPDATE players SET name = $2, name_key = $3 WHERE id = $1', [p.id, name, name.toLowerCase()]);
}

export const achievementList = () => ACHIEVEMENTS.map(({ id, nombre, descripcion, monedas }) => ({ id, nombre, descripcion, monedas }));
