/** Telemetría (fase 0): los eventos que se pueden registrar y sus límites. */

export const EVENT_KINDS = [
  'session_start', // { mode, map, mobile }
  'session_end', // { seconds }
  'play', // { mode: 'solo' | 'online', map }
  'map', // { map }
  'cut', // { combo, upset, bonus }
  'cut_by', // { cable }
  'crit', // { kind }
  'tail', // {}
  'delivery', // { n, coins }
  'buy', // { item }
  'level_up', // { level }
  'hit', // { revenge }
  'suspect', // (solo servidor) { reason, n }
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export interface TelemetryEvent {
  k: EventKind;
  d?: Record<string, unknown>;
  /** ms desde que se generó (para ordenar lotes atrasados). */
  ago?: number;
}

export const TELEMETRY = {
  maxPerBatch: 50,
  maxDataChars: 400,
  flushEvery: 20_000, // ms
};

export const isEventKind = (k: unknown): k is EventKind => typeof k === 'string' && (EVENT_KINDS as readonly string[]).includes(k);

/** Id anónimo del navegador: 8 a 40 letras, números o guiones. */
export const validAnonId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{8,40}$/.test(v);

/**
 * Limpia un lote que llega del navegador: solo tipos conocidos, datos chicos (JSON acotado)
 * y nunca eventos que solo puede generar el servidor.
 */
export function sanitizeEvents(raw: unknown): { kind: EventKind; data: Record<string, unknown>; ago: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { kind: EventKind; data: Record<string, unknown>; ago: number }[] = [];
  for (const e of raw.slice(0, TELEMETRY.maxPerBatch)) {
    if (!e || typeof e !== 'object') continue;
    const { k, d, ago } = e as TelemetryEvent;
    if (!isEventKind(k) || k === 'suspect') continue;
    let data: Record<string, unknown> = {};
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const json = JSON.stringify(d);
      if (json.length <= TELEMETRY.maxDataChars) data = JSON.parse(json);
    }
    const a = typeof ago === 'number' && Number.isFinite(ago) ? Math.min(3_600_000, Math.max(0, Math.floor(ago))) : 0;
    out.push({ kind: k, data, ago: a });
  }
  return out;
}
