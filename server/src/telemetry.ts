import crypto from 'node:crypto';
import { sanitizeEvents, validAnonId, type EventKind } from '@volantines/shared';
import { pool } from './db';

/** Guarda eventos (del navegador ya limpios, o del servidor). Nunca rompe el juego si la base falla. */
export async function recordEvents(
  events: { kind: EventKind; data: Record<string, unknown>; ago?: number }[],
  who: { playerId: number | null; anonId: string | null },
  source: 'client' | 'server',
) {
  if (!events.length) return;
  const values: unknown[] = [];
  const rows = events.map((e, i) => {
    values.push(who.playerId, who.anonId, e.kind, JSON.stringify(e.data), source, Math.max(0, e.ago ?? 0));
    const b = i * 6;
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, now() - ($${b + 6}::int * interval '1 millisecond'))`;
  });
  try {
    await pool.query(`INSERT INTO events (player_id, anon_id, kind, data, source, created_at) VALUES ${rows.join(', ')}`, values);
  } catch (err) {
    console.warn('No se pudo guardar la telemetría:', (err as Error).message);
  }
}

/** Lote que manda el navegador (POST /api/events). */
export async function recordClientBatch(body: unknown, playerId: number | null) {
  const b = (body ?? {}) as { anon?: unknown; events?: unknown };
  const anonId = validAnonId(b.anon) ? b.anon : null;
  const events = sanitizeEvents(b.events);
  if (!anonId && playerId === null) return 0;
  await recordEvents(events, { playerId, anonId }, 'client');
  return events.length;
}

/** Evento que vio el servidor en una sala (cuenta a los rankings: no lo puede inventar el cliente). */
export function recordServerEvent(kind: EventKind, playerId: number | null, data: Record<string, unknown> = {}) {
  void recordEvents([{ kind, data }], { playerId, anonId: null }, 'server');
}

/** ¿El token es el de administración (ADMIN_TOKEN en .env)? Sin ADMIN_TOKEN, nadie lo es. */
export function isAdmin(token: string | undefined) {
  const admin = process.env.ADMIN_TOKEN;
  if (!admin || !token || admin.length < 16) return false;
  const a = Buffer.from(admin);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Resumen para saber cómo va el juego: activos por día, retención, sesiones, modos y mapas. */
export async function adminStats() {
  const [daily, retention, sessions, modes, maps, suspects] = await Promise.all([
    pool.query(`SELECT day, COUNT(*)::int AS jugadores FROM daily_players WHERE day > now() - interval '14 days' GROUP BY day ORDER BY day DESC`),
    pool.query(`SELECT cohort, nuevos::int, volvieron_d1::int, volvieron_d7::int FROM retention LIMIT 14`),
    pool.query(
      `SELECT COUNT(*)::int AS sesiones, COALESCE(ROUND(AVG((data->>'seconds')::numeric) / 60, 1), 0)::float AS minutos_promedio
       FROM events WHERE kind = 'session_end' AND created_at > now() - interval '7 days'`,
    ),
    pool.query(
      `SELECT data->>'mode' AS modo, COUNT(*)::int AS veces FROM events
       WHERE kind = 'play' AND created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC`,
    ),
    pool.query(
      `SELECT data->>'map' AS mapa, COUNT(*)::int AS veces FROM events
       WHERE kind = 'play' AND created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC`,
    ),
    pool.query(
      `SELECT p.name, COUNT(*)::int AS avisos FROM events e LEFT JOIN players p ON p.id = e.player_id
       WHERE e.kind = 'suspect' AND e.created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    ),
  ]);
  return {
    activosPorDia: daily.rows,
    retencion: retention.rows,
    sesiones7d: sessions.rows[0],
    modos7d: modes.rows,
    mapas7d: maps.rows,
    sospechosos7d: suspects.rows,
  };
}
