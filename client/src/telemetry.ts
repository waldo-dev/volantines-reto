import { TELEMETRY, type EventKind, type TelemetryEvent } from '@volantines/shared';

const ANON_KEY = 'volantines.anon';

/** Id anónimo de este navegador (para medir retención también de los invitados). */
function anonId() {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * Telemetría del juego (fase 0): junta eventos y los manda en lotes a /api/events.
 * Nunca interrumpe el juego: si falla, se descarta.
 */
export class Telemetry {
  private queue: (TelemetryEvent & { at: number })[] = [];
  private anon = anonId();
  private startedAt = performance.now();
  private activeMs = 0;
  private activeSince: number | null = performance.now();

  constructor(private token: () => string | null) {
    setInterval(() => this.flush(), TELEMETRY.flushEvery);
    // Al esconder la pestaña: fin de sesión (tiempo activo) y se manda todo
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.pause();
        this.track('session_end', { seconds: Math.round(this.activeMs / 1000) });
        this.flush(true);
      } else if (this.activeSince === null) {
        this.activeSince = performance.now();
        this.activeMs = 0;
        this.track('session_start', { resumed: true });
      }
    });
  }

  private pause() {
    if (this.activeSince !== null) this.activeMs += performance.now() - this.activeSince;
    this.activeSince = null;
  }

  track(k: EventKind, d?: Record<string, unknown>) {
    this.queue.push({ k, d, at: performance.now() });
    if (this.queue.length >= TELEMETRY.maxPerBatch) this.flush();
  }

  /** Segundos desde que se abrió el juego. */
  get uptime() {
    return (performance.now() - this.startedAt) / 1000;
  }

  flush(leaving = false) {
    if (!this.queue.length) return;
    const now = performance.now();
    const events = this.queue.splice(0, TELEMETRY.maxPerBatch).map((e) => ({ k: e.k, d: e.d, ago: Math.round(now - e.at) }));
    const token = this.token();
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ anon: this.anon, events }),
      // Deja terminar el envío aunque se cierre la pestaña
      keepalive: leaving,
    }).catch(() => undefined);
  }
}
